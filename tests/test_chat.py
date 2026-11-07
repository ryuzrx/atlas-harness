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
        cfg = {"mode": "model", "provider_id": prov["id"], "model": "scripted", "access_level": "read_only", "tools": ["read"], "project_id": proj["id"]}
        out = c.post(f"/api/conversations/{conv['id']}/messages", json={"content": "Fix calc.py", "config": cfg}, headers=H).json()
        assert out["assistant"]["task_id"] and out["assistant"]["status"] == "running"
        full = wait_msg(c, conv["id"], timeout=30)
        task = c.get(f"/api/tasks/{out['assistant']['task_id']}", headers=H).json()
        assert task["config"]["tool_limit"] == ["project", "read", "write", "shell", "git", "memory", "mcp"]   # automatic: old read-only/tool picks are ignored
        assert task["agent_name"] == "Atlas Assistant"
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


def test_run_media_lists_and_serves_previews_safely(repo):
    script = {"General assistant": [("write_file", {"path": "renders/cube.png", "content": "PNGDATA"}),
                                    ("write_file", {"path": "model.stl", "content": "solid cube\nendsolid cube\n"}),
                                    ("finish", {"summary": "made a render and a model"})]}
    with client(script) as c:
        prov = c.post("/api/providers", json={"kind": "scripted", "name": "Scripted"}, headers=H).json()
        proj = c.post("/api/projects", json={"path": str(repo)}, headers=H).json()
        conv = c.post("/api/conversations", json={}, headers=H).json()
        cfg = {"mode": "model", "provider_id": prov["id"], "model": "scripted", "tools": ["read", "write"],
               "project_id": proj["id"], "auto_approve": True}
        out = c.post(f"/api/conversations/{conv['id']}/messages", json={"content": "Render it", "config": cfg}, headers=H).json()
        wait_msg(c, conv["id"], timeout=30)
        tid = out["assistant"]["task_id"]
        media = c.get(f"/api/tasks/{tid}/media", headers=H).json()
        kinds = {m["path"]: m["kind"] for m in media}
        assert kinds == {"renders/cube.png": "image", "model.stl": "model"}
        r = c.get(f"/api/tasks/{tid}/file", params={"path": "renders/cube.png", "token": TOKEN})
        assert r.status_code == 200 and r.content == b"PNGDATA"
        assert c.get(f"/api/tasks/{tid}/file", params={"path": "../../etc/passwd.png"}, headers=H).status_code == 403
        assert c.get(f"/api/tasks/{tid}/file", params={"path": "calc.py"}, headers=H).status_code == 415
        assert c.get(f"/api/tasks/{tid}/file", params={"path": "renders/cube.png"}).status_code == 401
