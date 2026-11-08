from atlas.agent import compact, parse_text_tool_calls


def test_fenced_and_bare_tool_calls():
    assert parse_text_tool_calls('```tool\n{"name":"finish","arguments":{"summary":"x"}}\n```')[0]["arguments"] == {"summary": "x"}
    assert parse_text_tool_calls('ok {"name": "read_file", "arguments": {"path": "a{b}.py"}}')[0]["arguments"] == {"path": "a{b}.py"}
    assert parse_text_tool_calls('{"name":"write_file","path":"a.py","content":"x"}')[0]["arguments"] == {"path": "a.py", "content": "x"}
    assert parse_text_tool_calls('{"name":"x","arguments":"{\\"k\\": 1}"}')[0]["arguments"] == {"k": 1}
    assert parse_text_tool_calls("def f(): return {1: 2}") == []


def test_compaction_keeps_task_and_respects_budget():
    msgs = [{"role": "system", "content": "sys"}, {"role": "user", "content": "TASK"}]
    for i in range(40):
        msgs += [{"role": "assistant", "content": f"step {i}"}, {"role": "user", "content": "TOOL RESULT (x):\n" + "y" * 2000}]
    out = compact([dict(m) for m in msgs], budget=3000)
    assert out[1]["content"] == "TASK"
    assert sum(len(m["content"]) for m in out) // 4 <= 3500


def test_edit_file_rejects_empty_old_text(tmp_path):
    import asyncio
    from atlas.tools import ToolContext, execute
    (tmp_path / "a.py").write_text("x = 1\n")
    async def deny(*a): return False
    async def noop(*a): return ""
    ctx = ToolContext(workspace=tmp_path, permissions=["write"], settings={}, request_approval=deny, remember=noop, send_message=noop)
    r = asyncio.run(execute(ctx, "edit_file", {"path": "a.py", "old_text": "", "new_text": "y", "replace_all": True}))
    assert not r["ok"] and "must not be empty" in r["output"]
    assert (tmp_path / "a.py").read_text() == "x = 1\n"


def test_attachment_tools_read_and_search_only_explicit_files(tmp_path):
    import asyncio
    from atlas.tools import PermissionDenied, ToolContext, t_list_attachments, t_read_file, t_search
    workspace = tmp_path / "workspace"
    uploads = tmp_path / "uploads"
    workspace.mkdir(); uploads.mkdir()
    attached = uploads / "notes.txt"
    attached.write_text("release code: ATLAS-42\n")
    sibling = uploads / "private.txt"
    sibling.write_text("private sibling")
    async def deny(*a): return False
    async def noop(*a): return ""
    ctx = ToolContext(workspace=workspace, permissions=["read"], settings={}, request_approval=deny,
                      remember=noop, send_message=noop, attached_files=[attached])
    assert asyncio.run(t_list_attachments(ctx)) == "notes.txt (23 bytes)"
    assert "ATLAS-42" in asyncio.run(t_read_file(ctx, str(attached)))
    assert "ATLAS-42" in asyncio.run(t_search(ctx, "ATLAS-42"))
    try:
        asyncio.run(t_read_file(ctx, str(sibling)))
        assert False, "unlisted sibling attachment must be refused"
    except PermissionDenied:
        pass


def test_read_file_can_inspect_a_bounded_range_from_large_file(tmp_path):
    import asyncio
    from atlas.tools import ToolContext, t_read_file
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    large = workspace / "large.log"
    large.write_text("entry\n" * 500_000)
    async def deny(*a): return False
    async def noop(*a): return ""
    ctx = ToolContext(workspace=workspace, permissions=["read"], settings={}, request_approval=deny,
                      remember=noop, send_message=noop)
    result = asyncio.run(t_read_file(ctx, "large.log", start_line=250_000, end_line=250_001))
    assert "lines 250000-250001" in result
    assert result.count("entry") == 2
    (workspace / "minified.js").write_text("x" * 3_000_000)
    minified = asyncio.run(t_read_file(ctx, "minified.js"))
    assert "line continues" in minified and len(minified) < 3_000


def test_search_scans_large_attachments_and_skips_workspace_symlinks(tmp_path):
    import asyncio
    from atlas.tools import ToolContext, t_search
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path / "private.txt"
    outside.write_text("DO_NOT_INDEX")
    (workspace / "outside.txt").symlink_to(outside)
    attached = tmp_path / "large.txt"
    attached.write_text(("ordinary line\n" * 100_000) + "target marker\n")
    async def deny(*a): return False
    async def noop(*a): return ""
    ctx = ToolContext(workspace=workspace, permissions=["read"], settings={}, request_approval=deny,
                      remember=noop, send_message=noop, attached_files=[attached])
    found = asyncio.run(t_search(ctx, "target marker"))
    assert "attachment:large.txt:100001" in found
    assert "DO_NOT_INDEX" not in asyncio.run(t_search(ctx, "DO_NOT_INDEX"))


def test_backend_stops_if_owning_desktop_process_disappears(monkeypatch):
    import asyncio
    from atlas import main
    class Server:
        should_exit = False
    server = Server()
    original_sleep = asyncio.sleep
    async def fast_sleep(_): await original_sleep(0)
    monkeypatch.setattr(main.asyncio, "sleep", fast_sleep)
    monkeypatch.setattr(main.os, "getppid", lambda: 1)
    asyncio.run(main.stop_when_supervisor_exits(server, 42))
    assert server.should_exit is True


def test_task_attachment_paths_must_match_user_chat_uploads(tmp_path):
    from atlas.orchestrator import authorized_chat_attachments
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    attached = uploads / "notes.txt"
    attached.write_text("permitted")
    arbitrary = tmp_path / "private.txt"
    arbitrary.write_text("not attached")
    class DB:
        def q(self, _sql, _args):
            return [{"data": {"attachments": [{"path": str(attached)}]}}]
    assert authorized_chat_attachments(DB(), {
        "conversation_id": "chat_1", "attached_files": [str(attached), str(arbitrary)]
    }) == [attached]


def test_deepseek_dsml_and_invoke_tool_calls():
    from atlas.agent import parse_text_tool_calls, strip_tool_markup
    dsml = ('CHECK\n<｜DSML｜ calls>\n<｜DSML｜ invoke name="run_command">\n'
            '<｜DSML｜ parameter name="command" string="true">ls -la packages/; unzip -l x.zip | head -80</｜DSML｜ parameter>\n'
            '<｜DSML｜ parameter name="timeout_s" string="false">60</｜DSML｜ parameter>\n'
            '</｜DSML｜ invoke>\n</｜DSML｜ calls>')
    calls = parse_text_tool_calls(dsml)
    assert calls == [{"id": "text_0", "name": "run_command",
                      "arguments": {"command": "ls -la packages/; unzip -l x.zip | head -80", "timeout_s": 60}}]
    assert strip_tool_markup(dsml) == "CHECK"
    plain = '<invoke name="read_file"><parameter name="path">src/a.ts</parameter></invoke>'
    assert parse_text_tool_calls(plain)[0]["arguments"] == {"path": "src/a.ts"}
