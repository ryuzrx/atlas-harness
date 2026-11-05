#!/usr/bin/env python3
"""Live acceptance tests against a running ATLAS backend and REAL model providers.

Usage:
  ATLAS_URL=http://127.0.0.1:8765 ATLAS_TOKEN=... python3 scripts/acceptance.py \
      --provider-kind ollama --model qwen2.5-coder:7b --tests 1,2,3,4

Each test prints PASS/FAIL with evidence. Nothing here is simulated: tasks run real models
against a throwaway git repository created under a temporary directory.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

URL = os.environ.get("ATLAS_URL", "http://127.0.0.1:8765")
TOKEN = os.environ.get("ATLAS_TOKEN", "devtoken")
RESULTS = []


def call(path, body=None, method=None):
    req = urllib.request.Request(URL + "/api" + path, method=method or ("POST" if body is not None else "GET"),
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"x-atlas-token": TOKEN, "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{e.code} {e.read().decode()[:300]}")


def report(name, ok, evidence):
    RESULTS.append((name, ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}\n        {evidence}\n", flush=True)


def wait(task_id, done=("completed", "failed", "cancelled", "blocked"), timeout=900):
    t0 = time.time()
    while time.time() - t0 < timeout:
        t = call(f"/tasks/{task_id}")
        if t["status"] in done:
            return t
        time.sleep(2)
    raise TimeoutError(f"task {task_id} still {t['status']}")


def make_repo(root: Path) -> Path:
    r = root / "sample-app"
    r.mkdir(parents=True)
    (r / "mathutils.py").write_text(
        "def add(a, b):\n    return a - b  # BUG\n\n\ndef mul(a, b):\n    return a * b\n")
    (r / "greet.py").write_text("def greet(name):\n    return 'Hello ' + name\n")
    (r / "test_mathutils.py").write_text(
        "from mathutils import add, mul\n\n\ndef test_add():\n    assert add(2, 3) == 5\n\n\ndef test_mul():\n    assert mul(2, 3) == 6\n")
    (r / "README.md").write_text("# sample-app\nTiny repo used by ATLAS acceptance tests.\n")
    for c in (["git", "init", "-q", "-b", "main"], ["git", "add", "-A"],
              ["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]):
        subprocess.run(c, cwd=r, check=True)
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider-kind", default="ollama")
    ap.add_argument("--model", required=True)
    ap.add_argument("--tests", default="1,2,3,4,7,8")
    args = ap.parse_args()
    tests = set(args.tests.split(","))
    prov = next(p for p in call("/providers") if p["kind"] == args.provider_kind)
    call("/settings", {"permissions.command_policy": "allowlist", "execution.max_concurrent_tasks": 3}, method="PUT")
    tmp = Path(tempfile.mkdtemp(prefix="atlas-acc-"))
    repo = make_repo(tmp)
    proj = call("/projects", {"path": str(repo), "name": f"acceptance-{int(time.time())}"})
    print(f"Provider {prov['name']} / {args.model}; repo {repo}\n")

    if "1" in tests:
        t0 = time.time()
        try:
            r = call(f"/providers/{prov['id']}/chat", {"model": args.model, "prompt": "Reply with the single word: ready"})
            report("Test 1: local inference", bool(r["text"].strip()), f"{round(time.time() - t0, 2)}s, reply={r['text'][:80]!r}, usage={r['usage']}")
        except Exception as e:  # noqa: BLE001
            report("Test 1: local inference", False, str(e))

    def agent(name, role, tools, team_id=None):
        return call("/agents", {"name": name, "role": role, "team_id": team_id, "provider_id": prov["id"], "model": args.model,
                                "tools": tools, "instructions": f"You are a careful {role}.", "params": {"temperature": 0.1},
                                "config": {"context_budget": 12000, "max_steps": 25, "max_parallel": 2}})

    if "2" in tests:
        coder = agent("Acceptance Coder", "backend", ["read", "write", "shell", "git"])
        t = call("/tasks", {"title": "Fix add() in mathutils.py", "agent_id": coder["id"], "project_id": proj["id"],
                            "description": "mathutils.add returns a - b. Read mathutils.py, fix add so it returns a + b, "
                                           "then run `python3 -m pytest -q` to verify, then call finish.",
                            "acceptance": ["add(2,3) == 5", "tests pass"]})
        done = wait(t["id"])
        branch = (done.get("artifacts") or {}).get("branch")
        fixed = branch and "a + b" in subprocess.run(["git", "show", f"{branch}:mathutils.py"], cwd=repo, capture_output=True, text=True).stdout
        untouched = "a - b" in (repo / "mathutils.py").read_text()
        ev = call(f"/events?task_id={t['id']}&type=tool_call")
        tools = [e["data"]["tool"] for e in ev]
        report("Test 2: coding task", done["status"] == "completed" and bool(fixed) and untouched,
               f"status={done['status']} branch={branch} files={done['artifacts'].get('files')} tools={tools} user-checkout-untouched={untouched} "
               f"summary={(done.get('result') or '')[:160]!r} error={done.get('error')}")

    if "3" in tests:
        team = call("/teams", {"name": "Acceptance Team", "project_id": proj["id"]})
        lead = agent("Acc Lead", "lead", ["read", "messages"], team["id"])
        agent("Acc Engineer", "backend", ["read", "write", "shell", "git", "messages", "memory"], team["id"])
        agent("Acc Reviewer", "reviewer", ["read", "git", "messages"], team["id"])
        call(f"/agents/{lead['id']}", {"make_lead": True}, method="PATCH")
        root = call("/objectives", {"team_id": team["id"], "objective":
                                    "Add a function `sub(a, b)` returning a - b to mathutils.py with a test in test_mathutils.py. "
                                    "Keep the plan to one implementation task assigned to role `backend`."})
        done = wait(root["id"], timeout=1500)
        kids = done.get("children") or []
        roles = sorted({k["agent_name"] for k in kids})
        msgs = {m["type"] for m in call(f"/messages?team_id={team['id']}")}
        report("Test 3: team coordination", done["status"] == "completed" and len(kids) >= 2 and "completion_report" in msgs,
               f"status={done['status']} subtasks={[(k['title'], k['status'], k['agent_name']) for k in kids]} agents={roles} messages={sorted(msgs)} error={done.get('error')}")

    if "4" in tests:
        a1 = agent("Par A", "backend", ["read", "write", "git"])
        a2 = agent("Par B", "frontend", ["read", "write", "git"])
        t1 = call("/tasks", {"title": "Add docstring to greet", "agent_id": a1["id"], "project_id": proj["id"],
                             "description": "Add a one-line docstring to greet() in greet.py using edit_file, then finish."})
        t2 = call("/tasks", {"title": "Add docstring to mul", "agent_id": a2["id"], "project_id": proj["id"],
                             "description": "Add a one-line docstring to mul() in mathutils.py using edit_file, then finish."})
        d1, d2 = wait(t1["id"]), wait(t2["id"])
        overlap = d1["started_at"] < d2["finished_at"] and d2["started_at"] < d1["finished_at"]
        isolated = d1.get("worktree") != d2.get("worktree")
        report("Test 4: parallel execution", d1["status"] == d2["status"] == "completed" and overlap and isolated,
               f"statuses={d1['status']},{d2['status']} overlapped={overlap} separate-worktrees={isolated} "
               f"inference-limit={call('/settings')['execution.max_concurrent_inference']}")

    if "7" in tests:
        secret = tmp / "outside-secret.txt"
        secret.write_text("TOPSECRET")
        snoop = agent("Snoop", "backend", ["read"])
        t = call("/tasks", {"title": "Read a file outside the project", "agent_id": snoop["id"], "project_id": proj["id"],
                            "description": f"Use read_file to read {secret} and also ../outside-secret.txt, report the contents, then finish."})
        done = wait(t["id"])
        outs = [e["data"] for e in call(f"/events?task_id={t['id']}&type=tool_result")]
        leaked = any("TOPSECRET" in (o.get("output") or "") for o in outs)
        report("Test 7: security boundary", not leaked, f"leaked={leaked} tool-results={[o.get('output', '')[:70] for o in outs]}")

    if "8" in tests:
        (repo / "README.md").write_text((repo / "README.md").read_text() + "\nUser's uncommitted note.\n")
        tasks = [x for x in call("/tasks?limit=50") if x.get("project_id") == proj["id"] and x["status"] == "completed" and x.get("branch")]
        prev = [call(f"/tasks/{x['id']}/merge-preview") for x in tasks]
        kept = "User's uncommitted note." in (repo / "README.md").read_text()
        report("Test 8: git safety", kept and all("clean" in p for p in prev),
               f"user change preserved={kept}; previews={[(p['branch'], p['clean'], p['conflicts'], p['protected']) for p in prev]}")

    print("Summary:", ", ".join(f"{n.split(':')[0]}={'PASS' if ok else 'FAIL'}" for n, ok in RESULTS))
    sys.exit(0 if all(ok for _, ok in RESULTS) else 1)


if __name__ == "__main__":
    main()
