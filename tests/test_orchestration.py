"""Orchestration tests through the real HTTP API with a scripted provider (test-only)."""
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from atlas import gitops
from atlas.providers import KINDS
from conftest import plan_json, script_provider_cls

TOKEN = "test-token"
H = {"x-atlas-token": TOKEN}


def make_client(script):
    KINDS["scripted"] = script_provider_cls(script)
    from atlas.api import create_app
    return TestClient(create_app(TOKEN))


def wait_for(c, tid, statuses, timeout=20):
    t0 = time.time()
    while time.time() - t0 < timeout:
        t = c.get(f"/api/tasks/{tid}", headers=H).json()
        if t["status"] in statuses:
            return t
        time.sleep(0.1)
    raise AssertionError(f"task stuck in {t['status']}: {t}")


def setup_team(c, repo, roles=("lead", "backend", "reviewer")):
    prov = c.post("/api/providers", json={"kind": "scripted", "name": "Scripted"}, headers=H).json()
    proj = c.post("/api/projects", json={"path": str(repo)}, headers=H).json()
    team = c.post("/api/teams", json={"name": "T", "project_id": proj["id"]}, headers=H).json()
    perms = {"lead": ["read", "messages"], "backend": ["read", "write", "shell", "git"], "reviewer": ["read", "git"],
             "frontend": ["read", "write"]}
    agents = {}
    for r in roles:
        agents[r] = c.post("/api/agents", json={"name": r.title(), "role": r, "team_id": team["id"], "provider_id": prov["id"],
                                                "model": "scripted", "tools": perms[r],
                                                "instructions": f"ROLE-{r.upper()}"}, headers=H).json()
    c.patch(f"/api/agents/{agents['lead']['id']}", json={"make_lead": True}, headers=H)
    return prov, proj, team, agents


def test_auth_required(repo):
    with make_client({}) as c:
        assert c.get("/api/teams").status_code == 401
        assert c.get("/api/teams", headers={"x-atlas-token": "wrong"}).status_code == 401
        assert c.get("/api/teams", headers=H).status_code == 200


def test_team_coordination_end_to_end(repo):
    script = {
        "ROLE-LEAD": [plan_json([
            {"key": "fix", "title": "Fix add()", "description": "add returns a-b", "role": "backend", "kind": "code",
             "deps": [], "acceptance": ["add(2,2)==4"]},
            {"key": "review", "title": "Review fix", "description": "review", "role": "reviewer", "kind": "review",
             "deps": ["fix"]}])],
        "ROLE-BACKEND": [("read_file", {"path": "calc.py"}),
                         ("edit_file", {"path": "calc.py", "old_text": "a - b", "new_text": "a + b"}),
                         ("finish", {"summary": "Fixed subtraction bug", "verification": "inspected"})],
        "ROLE-REVIEWER": [("git", {"action": "log"}), ("finish", {"summary": "LGTM"})],
    }
    with make_client(script) as c:
        _, proj, team, agents = setup_team(c, repo)
        root = c.post("/api/objectives", json={"team_id": team["id"], "objective": "Fix the add bug"}, headers=H).json()
        done = wait_for(c, root["id"], {"completed", "failed"})
        assert done["status"] == "completed", done
        kids = {k["title"]: k for k in done["children"]}
        fix = kids["Fix add()"]
        assert fix["agent_id"] == agents["backend"]["id"]
        assert fix["artifacts"]["files"] == ["calc.py"]
        assert fix["branch"].startswith("atlas/")
        # user's checkout untouched; change lives on the task branch
        assert "a - b" in (repo / "calc.py").read_text()
        assert "a + b" in gitops.git(repo, "show", f"{fix['branch']}:calc.py")
        # review task saw the fix merged into its worktree
        review = kids["Review fix"]
        assert review["deps"] == [fix["id"]]
        assert "a + b" in gitops.git(repo, "show", f"{review['branch']}:calc.py")
        # transitions persisted
        states = [t["to_status"] for t in c.get(f"/api/tasks/{fix['id']}", headers=H).json()["transitions"]]
        assert states[:4] == ["queued", "ready", "running", "completed"]
        msgs = c.get("/api/messages", params={"team_id": team["id"]}, headers=H).json()
        assert {"completion_report", "artifact_handoff", "task_assignment"} <= {m["type"] for m in msgs}
        # merge into protected branch requires confirmation
        r = c.post(f"/api/tasks/{review['id']}/merge", json={}, headers=H)
        assert r.status_code == 409 and "protected" in r.json()["detail"]
        r = c.post(f"/api/tasks/{review['id']}/merge", json={"confirm_protected": True}, headers=H)
        assert r.status_code == 200, r.text
        assert "a + b" in (repo / "calc.py").read_text()
        r = c.post(f"/api/tasks/{review['id']}/rollback", headers=H)
        assert r.status_code == 200
        assert "a - b" in (repo / "calc.py").read_text()


def test_parallel_independent_tasks_and_conflict_detection(repo):
    script = {
        "ROLE-LEAD": [plan_json([
            {"key": "a", "title": "A", "description": "", "role": "backend", "kind": "code", "deps": []},
            {"key": "b", "title": "B", "description": "", "role": "frontend", "kind": "code", "deps": []}])],
        "ROLE-BACKEND": [("write_file", {"path": "shared.txt", "content": "from A\n"}), ("finish", {"summary": "A"})],
        "ROLE-FRONTEND": [("write_file", {"path": "shared.txt", "content": "from B\n"}), ("finish", {"summary": "B"})],
    }
    with make_client(script) as c:
        _, _, team, _ = setup_team(c, repo, roles=("lead", "backend", "frontend"))
        root = c.post("/api/objectives", json={"team_id": team["id"], "objective": "two things"}, headers=H).json()
        done = wait_for(c, root["id"], {"completed", "failed"})
        assert done["status"] == "completed"
        a, b = sorted(done["children"], key=lambda k: k["title"])
        assert a["worktree"] != b["worktree"]  # isolation
        assert a["started_at"] < b["finished_at"] and b["started_at"] < a["finished_at"]  # overlapped in time
        overlaps = done["artifacts"]["overlaps"]
        assert overlaps and overlaps[0]["files"] == ["shared.txt"]
        assert not (repo / "shared.txt").exists()


def test_command_approval_flow_and_denial(repo):
    script = {
        "ROLE-LEAD": [plan_json([{"key": "x", "title": "Run", "description": "", "role": "backend", "kind": "code", "deps": []}])],
        "ROLE-BACKEND": [("run_command", {"command": "make something"}), ("finish", {"summary": "done"})],
    }
    with make_client(script) as c:
        _, _, team, _ = setup_team(c, repo, roles=("lead", "backend"))
        root = c.post("/api/objectives", json={"team_id": team["id"], "objective": "run"}, headers=H).json()
        t0 = time.time()
        pending = []
        while time.time() - t0 < 10 and not pending:
            pending = c.get("/api/approvals", headers=H).json()
            time.sleep(0.1)
        assert pending and pending[0]["payload"]["command"] == "make something"
        assert c.get(f"/api/tasks/{pending[0]['task_id']}", headers=H).json()["status"] == "waiting_approval"
        c.post(f"/api/approvals/{pending[0]['id']}", json={"approved": False}, headers=H)
        done = wait_for(c, root["id"], {"completed", "failed"})
        ev = c.get("/api/events", params={"task_id": pending[0]["task_id"], "type": "tool_result"}, headers=H).json()
        assert ev[0]["data"]["denied"] is True


def test_unauthorized_file_access_via_agent(repo, tmp_path):
    (tmp_path / "private.txt").write_text("secret")
    script = {
        "ROLE-LEAD": [plan_json([{"key": "x", "title": "Snoop", "description": "", "role": "backend", "kind": "code", "deps": []}])],
        "ROLE-BACKEND": [("read_file", {"path": str(tmp_path / "private.txt")}), ("read_file", {"path": "../private.txt"}),
                         ("finish", {"summary": "tried"})],
    }
    with make_client(script) as c:
        _, _, team, _ = setup_team(c, repo, roles=("lead", "backend"))
        root = c.post("/api/objectives", json={"team_id": team["id"], "objective": "x"}, headers=H).json()
        done = wait_for(c, root["id"], {"completed", "failed"})
        tid = done["children"][0]["id"]
        results = c.get("/api/events", params={"task_id": tid, "type": "tool_result"}, headers=H).json()
        assert all(not r["data"]["ok"] and "outside the workspace" in r["data"]["output"] for r in results[:2])
        assert all("secret" not in r["data"]["output"] for r in results)


def test_persistence_and_restart_recovery(repo):
    script = {"ROLE-LEAD": []}
    with make_client(script) as c:
        _, proj, team, agents = setup_team(c, repo, roles=("lead", "backend"))
        c.put("/api/settings", json={"execution.max_concurrent_tasks": 5}, headers=H)
        t = c.post("/api/tasks", json={"title": "manual", "team_id": team["id"], "agent_id": agents["backend"]["id"]}, headers=H).json()
        from atlas.api import S
        S.db.update("tasks", t["id"], {"status": "running"})  # simulate a crash mid-run
        S.orch.cancel = lambda *a, **k: None
    with make_client(script) as c:  # "restart": new app, same data dir
        assert c.get("/api/settings", headers=H).json()["execution.max_concurrent_tasks"] == 5
        assert any(x["id"] == team["id"] for x in c.get("/api/teams", headers=H).json())
        task = c.get(f"/api/tasks/{t['id']}", headers=H).json()
        assert task["status"] == "failed" and "restart" in task["transitions"][-1]["reason"]
        assert c.post(f"/api/tasks/{t['id']}/retry", headers=H).status_code == 200


def test_provider_failure_marks_task_failed(repo):
    with make_client({}) as c:
        prov = c.post("/api/providers", json={"kind": "openai_compat", "name": "Dead", "base_url": "http://127.0.0.1:9"}, headers=H).json()
        proj = c.post("/api/projects", json={"path": str(repo)}, headers=H).json()
        team = c.post("/api/teams", json={"name": "T", "project_id": proj["id"]}, headers=H).json()
        lead = c.post("/api/agents", json={"name": "L", "role": "lead", "team_id": team["id"], "provider_id": prov["id"],
                                           "model": "x"}, headers=H).json()
        c.patch(f"/api/agents/{lead['id']}", json={"make_lead": True}, headers=H)
        root = c.post("/api/objectives", json={"team_id": team["id"], "objective": "x"}, headers=H).json()
        done = wait_for(c, root["id"], {"failed"}, timeout=40)
        assert "connection failed" in (done["error"] or "").lower() or "connect" in done["transitions"][-1]["reason"].lower()
        assert c.get("/api/health", headers=H).status_code == 200  # still responsive


def test_cycle_rejected(repo):
    with make_client({}) as c:
        a = c.post("/api/tasks", json={"title": "a"}, headers=H).json()
        b = c.post("/api/tasks", json={"title": "b", "deps": [a["id"]]}, headers=H).json()
        r = c.patch(f"/api/tasks/{a['id']}", json={"deps": [b["id"]]}, headers=H)
        assert r.status_code in (400, 409)


def test_unassigned_task_does_not_flip_flop(repo):
    """Regression: a task with no agent used to toggle blocked <-> ready on every scheduler pass,
    spamming the transition log and (on Python 3.12) starving the API event loop."""
    with make_client({}) as c:
        t = c.post("/api/tasks", json={"title": "orphan"}, headers=H).json()
        time.sleep(1.5)
        full = c.get(f"/api/tasks/{t['id']}", headers=H).json()
        assert full["status"] == "blocked"
        assert len(full["transitions"]) <= 3, [x["to_status"] for x in full["transitions"]]
        assert c.get("/api/health", headers=H).status_code == 200


def test_blocked_dependency_propagates_and_objective_finishes(repo):
    script = {
        "ROLE-LEAD": [plan_json([
            {"key": "a", "title": "A", "description": "", "role": "backend", "kind": "code", "deps": []},
            {"key": "b", "title": "B", "description": "", "role": "backend", "kind": "code", "deps": ["a"]},
            {"key": "c", "title": "C", "description": "", "role": "backend", "kind": "code", "deps": ["b"]}])],
        "ROLE-BACKEND": [("finish", {"summary": "cannot", "status": "failed"})],
    }
    with make_client(script) as c:
        _, _, team, _ = setup_team(c, repo, roles=("lead", "backend"))
        root = c.post("/api/objectives", json={"team_id": team["id"], "objective": "chain"}, headers=H).json()
        done = wait_for(c, root["id"], {"completed", "failed"})
        st = {k["title"]: k["status"] for k in done["children"]}
        assert st == {"A": "failed", "B": "blocked", "C": "blocked"}, st
        assert done["status"] == "failed"


def test_cli_env_strips_inherited_keys(monkeypatch):
    from atlas.providers.cli_agents import cli_env
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    monkeypatch.setenv("CLAUDE_CODE_ENTRYPOINT", "x")
    monkeypatch.setenv("OPENAI_API_KEY", "y")
    assert "ANTHROPIC_API_KEY" not in cli_env("/usr/local/bin/claude")
    assert "CLAUDE_CODE_ENTRYPOINT" not in cli_env("/usr/local/bin/claude")
    assert "OPENAI_API_KEY" in cli_env("/usr/local/bin/claude")
    assert "OPENAI_API_KEY" not in cli_env("/opt/homebrew/bin/codex")
    assert cli_env("/usr/local/bin/claude", use_env_auth=True)["ANTHROPIC_API_KEY"] == "x"
