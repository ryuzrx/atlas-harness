"""Chat-first API: conversations, model streaming, tool-limited agent turns, persistence."""
import time

from fastapi.testclient import TestClient

from atlas.providers import KINDS
from conftest import script_provider_cls

TOKEN = "test-token"
H = {"x-atlas-token": TOKEN}


def client(script):
    KINDS["scripted"] = script_provider_cls(script)
    from atlas.api import create_app
    return TestClient(create_app(TOKEN))


def wait_msg(c, cid, timeout=20):
    t0 = time.time()
    while time.time() - t0 < timeout:
        conv = c.get(f"/api/conversations/{cid}", headers=H).json()
        last = conv["messages"][-1]
        if last["role"] == "assistant" and last["status"] not in ("streaming", "running"):
            return conv
        time.sleep(0.1)
    raise AssertionError(f"assistant still {last['status']}")


def test_model_chat_history_search_rename_delete_and_persistence(data_dir):
    with client({"You are Atlas": ["Hello! I am Atlas.", "Second answer."]}) as c:
        prov = c.post("/api/providers", json={"kind": "scripted", "name": "Scripted"}, headers=H).json()
        conv = c.post("/api/conversations", json={}, headers=H).json()
        assert conv["title"] == "New chat"
        cfg = {"mode": "model", "provider_id": prov["id"], "model": "scripted"}
        r = c.post(f"/api/conversations/{conv['id']}/messages", json={"content": "Say hi to the team", "config": cfg}, headers=H)
        assert r.status_code == 200, r.text
        full = wait_msg(c, conv["id"])
        assert full["title"] == "Say hi to the team"           # auto-titled from the first message
        assert full["messages"][-1]["content"] == "Hello! I am Atlas."
        assert full["messages"][-1]["status"] == "done"
        # follow-up carries history and an attachment
        c.post(f"/api/conversations/{conv['id']}/messages",
               json={"content": "And this file?", "attachments": [{"name": "notes.txt", "content": "alpha beta"}]}, headers=H)
        full = wait_msg(c, conv["id"])
        assert len(full["messages"]) == 4 and full["messages"][-1]["content"] == "Second answer."
        sent = KINDS["scripted"].calls[-1]["messages"]
        assert [m["role"] for m in sent] == ["system", "user", "assistant", "user"]
        assert "alpha beta" in sent[-1]["content"]              # attachment reached the model
        # search by message content, rename
        assert [x["id"] for x in c.get("/api/conversations?q=Hello", headers=H).json()] == [conv["id"]]
        assert c.get("/api/conversations?q=zzzz", headers=H).json() == []
        assert c.patch(f"/api/conversations/{conv['id']}", json={"title": "Greetings"}, headers=H).json()["title"] == "Greetings"
        # empty message rejected; missing model rejected
        assert c.post(f"/api/conversations/{conv['id']}/messages", json={"content": "  "}, headers=H).status_code == 400
        other = c.post("/api/conversations", json={}, headers=H).json()
        r = c.post(f"/api/conversations/{other['id']}/messages", json={"content": "hi", "config": {"mode": "model"}}, headers=H)
        assert r.status_code == 400 and "model" in r.json()["detail"].lower()
    # restart: history persists
    with client({}) as c:
        convs = c.get("/api/conversations", headers=H).json()
        assert {x["title"] for x in convs} >= {"Greetings"}
        cid = next(x["id"] for x in convs if x["title"] == "Greetings")
        assert len(c.get(f"/api/conversations/{cid}", headers=H).json()["messages"]) == 4
        assert c.delete(f"/api/conversations/{cid}", headers=H).json()["ok"]
        assert c.get(f"/api/conversations/{cid}", headers=H).status_code == 404


def test_model_with_tools_runs_as_agent_and_tool_limit_is_enforced(repo):
    script = {"General assistant": [("write_file", {"path": "calc.py", "content": "hacked\n"}),
                                    ("finish", {"summary": "Could not write; read-only access."})]}
    with client(script) as c:
        prov = c.post("/api/providers", json={"kind": "scripted", "name": "Scripted"}, headers=H).json()
        proj = c.post("/api/projects", json={"path": str(repo)}, headers=H).json()
        conv = c.post("/api/conversations", json={}, headers=H).json()
        cfg = {"mode": "model", "provider_id": prov["id"], "model": "scripted", "tools": ["read"], "project_id": proj["id"]}
        out = c.post(f"/api/conversations/{conv['id']}/messages", json={"content": "Fix calc.py", "config": cfg}, headers=H).json()
        assert out["assistant"]["task_id"] and out["assistant"]["status"] == "running"
        full = wait_msg(c, conv["id"], timeout=30)
        task = c.get(f"/api/tasks/{out['assistant']['task_id']}", headers=H).json()
        assert task["config"]["tool_limit"] == ["read"]
        assert task["agent_name"] == "Atlas Assistant"
        assert (repo / "calc.py").read_text() == "def add(a, b):\n    return a - b\n"   # write tool was not available
        assert full["messages"][-1]["status"] == "done"
        assert "read-only" in full["messages"][-1]["content"]
        # the assistant agent is reused, not duplicated
        c.post(f"/api/conversations/{conv['id']}/messages", json={"content": "again"}, headers=H)
        wait_msg(c, conv["id"], timeout=30)
        agents = [a for a in c.get("/api/agents", headers=H).json() if a["name"] == "Atlas Assistant"]
        assert len(agents) == 1


def test_project_chat_with_only_project_context_gets_workspace_tools(repo):
    """Work-sidebar chats send tools=["project"]; that must still run as an agent, not plain streaming."""
    script = {"General assistant": [("finish", {"summary": "ok"})]}
    with client(script) as c:
        prov = c.post("/api/providers", json={"kind": "scripted", "name": "Scripted"}, headers=H).json()
        proj = c.post("/api/projects", json={"path": str(repo)}, headers=H).json()
        conv = c.post("/api/conversations", json={}, headers=H).json()
        cfg = {"mode": "model", "provider_id": prov["id"], "model": "scripted", "tools": ["project"], "project_id": proj["id"]}
        out = c.post(f"/api/conversations/{conv['id']}/messages", json={"content": "Build it", "config": cfg}, headers=H).json()
        assert out["assistant"]["task_id"]
        wait_msg(c, conv["id"], timeout=30)
        task = c.get(f"/api/tasks/{out['assistant']['task_id']}", headers=H).json()
        assert set(task["config"]["tool_limit"]) >= {"read", "write", "shell", "git"}
