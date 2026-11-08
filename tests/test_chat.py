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


def test_prompt_enhancer_uses_selected_model_without_creating_chat_history():
    with client({"Rewrite the user's draft": ["Fix the startup issue, then summarize the changes and verification."]}) as c:
        prov = c.post("/api/providers", json={"kind": "scripted", "name": "Scripted"}, headers=H).json()
        result = c.post("/api/prompts/enhance", json={
            "provider_id": prov["id"], "model": "scripted", "prompt": "fix startup and explain"
        }, headers=H)
        assert result.status_code == 200, result.text
        assert result.json()["prompt"] == "Fix the startup issue, then summarize the changes and verification."
        assert c.get("/api/conversations", headers=H).json() == []


def test_model_chat_compares_selected_models_in_parallel():
    with client({"You are Atlas": ["First model response.", "Second model response."]}) as c:
        first = c.post("/api/providers", json={"kind": "scripted", "name": "First"}, headers=H).json()
        second = c.post("/api/providers", json={"kind": "scripted", "name": "Second"}, headers=H).json()
        conv = c.post("/api/conversations", json={}, headers=H).json()
        selected = [
            {"provider_id": first["id"], "model": "scripted"},
            {"provider_id": second["id"], "model": "scripted"},
        ]
        result = c.post(f"/api/conversations/{conv['id']}/messages", json={
            "content": "Compare these answers", "config": {"mode": "model", "provider_id": first["id"],
            "model": "scripted", "compare_models": selected}
        }, headers=H)
        assert result.status_code == 200, result.text
        assert len(result.json()["assistants"]) == 2
        deadline = time.time() + 10
        while time.time() < deadline:
            full = c.get(f"/api/conversations/{conv['id']}", headers=H).json()
            responses = [m for m in full["messages"] if m["role"] == "assistant"]
            if len(responses) == 2 and all(m["status"] == "done" for m in responses):
                break
            time.sleep(0.05)
        assert len(responses) == 2 and all(m["status"] == "done" for m in responses)
        assert {m["content"] for m in responses} == {"First model response.", "Second model response."}
        assert len({m["data"]["compare_group"] for m in responses}) == 1
        assert {m["data"]["provider_id"] for m in responses} == {first["id"], second["id"]}


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


def test_large_upload_is_read_with_tools_not_pasted():
    """Files over the inline limit are streamed to disk; the run gets read access, the prompt gets only a path."""
    big = ("line of data\n" * 40_000).encode()   # ~520 KB, over the 200 KB inline limit
    script = {"General assistant": [("read_file", {"path": "PLACEHOLDER"}), ("finish", {"summary": "read it"})]}
    with client(script) as c:
        up = c.post("/api/uploads?name=data.log", content=big, headers=H).json()
        assert up["size"] == len(big) and up["name"] == "data.log"
        from atlas.chat import uploads_dir
        path = str(uploads_dir() / up["id"] / "data.log")
        script["General assistant"][0] = ("read_file", {"path": path})
        prov = c.post("/api/providers", json={"kind": "scripted", "name": "Scripted"}, headers=H).json()
        conv = c.post("/api/conversations", json={}, headers=H).json()
        cfg = {"mode": "model", "provider_id": prov["id"], "model": "scripted"}
        out = c.post(f"/api/conversations/{conv['id']}/messages", json={
            "content": "Summarize this log", "config": cfg,
            "attachments": [{"name": "data.log", "type": "text/plain", "upload_id": up["id"]}]}, headers=H).json()
        assert out["assistant"]["task_id"], "a large upload runs with tools even without a project"
        wait_msg(c, conv["id"], timeout=30)
        task = c.get(f"/api/tasks/{out['assistant']['task_id']}", headers=H).json()
        assert task["config"]["attached_files"] == [path]
        assert "line of data" not in task["description"]          # bytes are never pasted into the prompt
        events = c.get(f"/api/events?task_id={task['id']}&type=tool_result", headers=H).json()
        assert any(e["data"].get("tool") == "read_file" and e["data"].get("ok") for e in events)
        # deleting the chat removes the upload
        c.delete(f"/api/conversations/{conv['id']}", headers=H)
        assert not (uploads_dir() / up["id"]).exists()


def test_chunked_upload_appends_in_order():
    with client({}) as c:
        first = c.post("/api/uploads?name=big.bin", content=b"a" * 10, headers=H).json()
        assert first["size"] == 10
        second = c.post(f"/api/uploads?id={first['id']}&offset=10", content=b"b" * 5, headers=H).json()
        assert second == {"id": first["id"], "name": "big.bin", "size": 15}
        # a piece sent at the wrong offset is refused instead of corrupting the file
        assert c.post(f"/api/uploads?id={first['id']}&offset=3", content=b"x", headers=H).status_code == 409
        from atlas.chat import uploads_dir
        assert (uploads_dir() / first["id"] / "big.bin").read_bytes() == b"a" * 10 + b"b" * 5


def test_attachment_path_from_request_is_never_trusted():
    with client({"You are Atlas": ["I can only inspect files actually attached here."]}) as c:
        prov = c.post("/api/providers", json={"kind": "scripted", "name": "Scripted"}, headers=H).json()
        conv = c.post("/api/conversations", json={}, headers=H).json()
        cfg = {"mode": "model", "provider_id": prov["id"], "model": "scripted"}
        response = c.post(f"/api/conversations/{conv['id']}/messages", json={
            "content": "Read this file", "config": cfg,
            "attachments": [{"name": "hosts", "type": "text/plain", "path": "/etc/hosts", "content": ""}]}, headers=H)
        assert response.status_code == 200
        saved = c.get(f"/api/conversations/{conv['id']}", headers=H).json()["messages"][0]
        assert "path" not in saved["data"]["attachments"][0]


def test_open_path_resolves_project_files_and_refuses_system_paths(repo, monkeypatch):
    import atlas.api as api_mod
    opened = []
    monkeypatch.setattr(api_mod.subprocess, "run", lambda args, check=False: opened.append(args))
    with client({}) as c:
        proj = c.post("/api/projects", json={"path": str(repo)}, headers=H).json()
        out = c.post("/api/open", json={"path": "calc.py:12", "project_id": proj["id"]}, headers=H).json()
        assert out["ok"] and out["path"].endswith("calc.py") and opened[-1][0] == "open" and "-R" not in opened[-1]
        c.post("/api/open", json={"path": "calc.py", "project_id": proj["id"], "reveal": True}, headers=H)
        assert opened[-1][1] == "-R"
        assert c.post("/api/open", json={"path": "nope.py", "project_id": proj["id"]}, headers=H).status_code == 404
        assert c.post("/api/open", json={"path": "/etc/hosts"}, headers=H).status_code == 403
