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
