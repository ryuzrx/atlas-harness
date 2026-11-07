"""Agent runtime: context assembly, model interaction, tool execution loop.

Two tool protocols:
  * native  - provider-side function calling (verified per model).
  * text    - fenced ```tool JSON blocks, for models without a tool-calling template
              (common for abliterated / community fine-tunes served by Ollama or llama.cpp).
"""
from __future__ import annotations

import asyncio
import itertools
import json
import re
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional

from .providers import ModelRouter, ProviderError
from . import extensions
from .tools import ToolContext, execute, tools_for

Emit = Callable[[str, Dict[str, Any]], Awaitable[None]]

TOOL_BLOCK = re.compile(r"```(?:tool|tool_call|json)\s*\n(.*?)\n?```", re.S)


def est_tokens(text: str) -> int:
    """Rough estimate (chars/4). Shown in the UI as an estimate, not a measurement."""
    return max(1, len(text) // 4)


def messages_tokens(msgs: List[Dict[str, Any]]) -> int:
    def content_cost(content: Any) -> int:
        if isinstance(content, str):
            return est_tokens(content)
        if isinstance(content, list):
            cost = 0
            for block in content:
                if block.get("type") == "image":
                    cost += 1200  # keep image cost bounded; raw base64 length is not token usage
                else:
                    cost += est_tokens(str(block.get("text") or ""))
            return cost
        return est_tokens(json.dumps(content, ensure_ascii=False))
    return sum(content_cost(m.get("content")) + est_tokens(json.dumps(m.get("tool_calls") or "")) for m in msgs)


def compact(msgs: List[Dict[str, Any]], budget: int) -> List[Dict[str, Any]]:
    """Keep system + task + recent turns; elide old tool outputs first. Never drops the task statement."""
    if messages_tokens(msgs) <= budget:
        return msgs
    head, tail = msgs[:2], msgs[2:]
    for m in tail[:-6]:
        if m["role"] == "tool" or (m["role"] == "user" and isinstance(m.get("content"), str)
                                      and m["content"].startswith("TOOL RESULT")):
            c = m.get("content") or ""
            if len(c) > 400:
                m["content"] = c[:200] + f"\n…[older tool output elided, {len(c)} chars]…"
    while messages_tokens(head + tail) > budget and len(tail) > 6:
        # drop the oldest exchange but keep tool_call/tool pairs consistent
        tail.pop(0)
        while tail and tail[0]["role"] == "tool":
            tail.pop(0)
    note = {"role": "user", "content": "[Context note: earlier steps were compacted to fit the context budget. "
                                       "Re-read files if you need exact contents.]"}
    return head + [note] + tail


def text_protocol_instructions(tools: List[Dict[str, Any]]) -> str:
    lines = ["You can use tools. To call a tool, reply with ONE fenced block and nothing after it:",
             "```tool", '{"name": "<tool name>", "arguments": {...}}', "```",
             "The result will be returned in the next message. Call one tool per reply.",
             "When the task is complete, call the `finish` tool. Available tools:"]
    for t in tools:
        props = t["parameters"]["properties"]
        req = set(t["parameters"]["required"])
        args = ", ".join(f"{k}{'' if k in req else '?'}: {v.get('type', 'any')}" for k, v in props.items())
        lines.append(f"- {t['name']}({args}): {t['description']}")
    return "\n".join(lines)


def _bare_json_objects(text: str) -> List[str]:
    """Top-level {...} spans in free text (models often emit tool JSON without a fence)."""
    out, depth, start, in_str, esc = [], 0, -1, False, False
    for i, ch in enumerate(text):
        if in_str:
            esc = (not esc) and ch == "\\"
            if ch == '"' and not esc:
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}" and depth:
            depth -= 1
            if depth == 0:
                out.append(text[start:i + 1])
    return out


# XML-style calls some models print as text instead of using the API's tool calls, e.g. DeepSeek's
# <｜DSML｜ invoke name="run_command"><｜DSML｜ parameter name="command" string="true">ls</｜DSML｜ parameter>
# and the plain <invoke name="..."><parameter name="...">...</parameter></invoke> form.
INVOKE_BLOCK = re.compile(r"<[^<>]*?\binvoke\s+name=\"([^\"]+)\"[^<>]*>(.*?)</[^<>]*?\binvoke\s*>", re.S)
PARAM_BLOCK = re.compile(r"<[^<>]*?\bparameter\s+name=\"([^\"]+)\"([^<>]*)>(.*?)</[^<>]*?\bparameter\s*>", re.S)
CALLS_WRAPPER = re.compile(r"<[^<>]*?\b(?:function_)?calls\s*>|</[^<>]*?\b(?:function_)?calls\s*>")


def _parse_invoke_calls(text: str) -> List[Dict[str, Any]]:
    calls = []
    for i, m in enumerate(INVOKE_BLOCK.finditer(text)):
        args: Dict[str, Any] = {}
        for p in PARAM_BLOCK.finditer(m.group(2)):
            name, attrs, raw = p.group(1), p.group(2), p.group(3).strip()
            value: Any = raw
            if 'string="false"' in attrs or 'string="true"' not in attrs:
                try:
                    value = json.loads(raw)   # numbers, booleans, objects; plain text stays text
                except ValueError:
                    value = raw
            args[name] = value
        calls.append({"id": f"text_{i}", "name": m.group(1), "arguments": args})
    return calls


def strip_tool_markup(text: str) -> str:
    """Remove printed tool-call markup so it never shows up as the reply."""
    return CALLS_WRAPPER.sub("", INVOKE_BLOCK.sub("", text or "")).strip()


def parse_text_tool_calls(text: str) -> List[Dict[str, Any]]:
    invoked = _parse_invoke_calls(text or "")
    if invoked:
        return invoked[:1]
    calls = []
    blocks = [m.group(1) for m in TOOL_BLOCK.finditer(text)] or _bare_json_objects(text)
    for i, raw in enumerate(blocks):
        try:
            obj = json.loads(raw)
        except ValueError:
            continue
        if isinstance(obj, dict) and obj.get("name"):
            args = obj.get("arguments") or obj.get("args") or obj.get("parameters") or obj.get("input") or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except ValueError:
                    args = {}
            if not args:  # some models flatten arguments into the top-level object
                args = {k: v for k, v in obj.items() if k not in ("name", "type", "id")}
            calls.append({"id": f"text_{i}", "name": obj["name"], "arguments": args if isinstance(args, dict) else {}})
    return calls[:1]


class AgentRunner:
    def __init__(self, router: ModelRouter):
        self.router = router

    async def run(self, *, agent: Dict[str, Any], system_prompt: str, task_prompt: str, ctx: ToolContext,
                  emit: Emit, max_steps: int = 0, checkpoint: Callable[[int, Dict[str, Any]], None],
                  on_token: Optional[Callable[[str], Awaitable[None]]] = None) -> Dict[str, Any]:
        prov = self.router.get(agent["provider_id"])
        model = agent["model"]
        if hasattr(prov, "ensure_caps"):
            await prov.ensure_caps(model)  # type: ignore[attr-defined]
        skills_text = extensions.skills_prompt(ctx.settings) if "read" in ctx.permissions else ""
        tool_defs = tools_for(ctx.permissions, bool(ctx.mcp_call), bool(skills_text), bool(ctx.ask_user), bool(ctx.computer_use))
        schemas = [{"name": t["name"], "description": t["description"], "parameters": t["parameters"]} for t in tool_defs]
        native = prov.tool_support(model)
        mode = "native" if native else "text"
        if native is None:
            mode = "text"  # unverified: the text protocol works with every model
        system = system_prompt + ("\n\n" + text_protocol_instructions(schemas) if mode == "text" else
                                  "\n\nUse the provided tools. Call `finish` when the task is complete.")
        if skills_text:
            system += "\n\n" + skills_text
        if ctx.mcp_tools:
            system += "\n\nAuthorized MCP tools (call via the `mcp` tool):\n" + "\n".join(
                f"- {t['name']}: {t['description'][:160]}" for t in ctx.mcp_tools[:40])
        msgs: List[Dict[str, Any]] = [{"role": "system", "content": system}, {"role": "user", "content": task_prompt}]
        params = dict(agent.get("params") or {})
        budget = int((agent.get("config") or {}).get("context_budget") or 16000)
        params.setdefault("num_ctx", min(max(budget + 4096, 8192), 131072))
        await emit("agent_started", {"model": model, "provider": prov.name, "provider_kind": prov.kind, "tool_mode": mode,
                                      "context_budget": budget})
        nudged = 0
        recent: List[str] = []
        usage_total = {"prompt_tokens": 0, "completion_tokens": 0}
        # No step limit: the agent works until it finishes. The repeat guard below still stops a stuck loop.
        for step in itertools.count(1):
            msgs = compact(msgs, budget)
            est = messages_tokens(msgs)
            await emit("llm_request", {"step": step, "est_prompt_tokens": est, "messages": len(msgs)})

            async def waiting():
                await emit("queued_for_model", {"step": step, "provider": prov.name})

            t0 = time.perf_counter()
            res = await self.router.chat(agent["provider_id"], model, msgs, tools=schemas if mode == "native" else None,
                                         params=params, on_token=on_token, on_wait=waiting)
            for k in usage_total:
                usage_total[k] += int(res.usage.get(k) or 0)
            calls = res.tool_calls if mode == "native" else parse_text_tool_calls(res.text)
            if mode == "native" and not calls and res.text.strip():
                calls = parse_text_tool_calls(res.text)  # model wrote the call as text despite native support
                if calls:
                    mode = "text"  # keep the conversation consistent with what the model actually does
                    msgs[0]["content"] += "\n\n" + text_protocol_instructions(schemas)
            visible = strip_tool_markup(TOOL_BLOCK.sub("", res.text) if mode == "text" else res.text)
            await emit("llm_response", {"step": step, "latency_ms": round((time.perf_counter() - t0) * 1000),
                                         "usage": res.usage, "tool_calls": len(calls)})
            if visible:
                await emit("agent_message", {"text": visible[:6000]})
            fingerprint = res.text.strip() + json.dumps(res.tool_calls, sort_keys=True)
            recent = (recent + [fingerprint])[-4:]
            if len(recent) >= 3 and len(set(recent[-3:])) == 1:
                await emit("error", {"message": "Agent repeated the same response three times; stopping to avoid a loop."})
                return {"status": "failed", "summary": "Stopped: the model repeated the same response three times.",
                        "verification": "", "steps": step, "usage": usage_total}
            if len(recent) == 3 and recent[-1] == recent[-2] and not calls:
                msgs.append({"role": "user", "content": "You are repeating yourself. Take a different concrete action with a tool, "
                                                        "or call `finish` with an honest status."})
            if mode == "native":
                msgs.append({"role": "assistant", "content": res.text, "tool_calls": calls})
            else:
                msgs.append({"role": "assistant", "content": res.text})
            if not calls:
                if nudged < 2:
                    nudged += 1
                    msgs.append({"role": "user", "content": "No tool call detected. Continue working with the tools, or call "
                                                            "`finish` with a summary if the task is complete."})
                    continue
                return {"status": "completed", "summary": visible or res.text, "verification": "", "steps": step,
                        "usage": usage_total, "note": "Agent ended without calling finish."}
            for call in calls:
                shown_args = _short_args(call["arguments"])
                if call["name"] == "computer_type":
                    shown_args = {"text": f"[{len(str(call['arguments'].get('text') or ''))} characters]"}
                await emit("tool_call", {"id": call["id"], "tool": call["name"], "args": shown_args})
                t1 = time.perf_counter()
                out = await execute(ctx, call["name"], call["arguments"])
                await emit("tool_result", {"id": call["id"], "tool": call["name"], "ok": out["ok"],
                                            "output": out["output"][:6000], "ms": round((time.perf_counter() - t1) * 1000),
                                            "denied": out.get("denied", False)})
                if call["name"] in ("write_file", "edit_file", "apply_patch") and out["ok"]:
                    await emit("file_edit", {"tool": call["name"], "path": call["arguments"].get("path"), "result": out["output"]})
                if mode == "native":
                    msgs.append({"role": "tool", "tool_call_id": call["id"], "name": call["name"], "content": out["output"]})
                else:
                    msgs.append({"role": "user", "content": f"TOOL RESULT ({call['name']}, ok={out['ok']}):\n{out['output']}"})
                if out.get("image"):
                    msgs.append({"role": "user", "content": [{"type": "text", "text": "Current screen capture. Analyze this frame before choosing the next action."}, out["image"]]})
                if ctx.finished:
                    break
            checkpoint(step, {"files_changed": sorted(ctx.files_changed), "commands": ctx.commands_run[-20:],
                              "messages": len(msgs)})
            if ctx.finished:
                return {**ctx.finished, "steps": step, "usage": usage_total}


def _short_args(args: Dict[str, Any]) -> Dict[str, Any]:
    out = {}
    for k, v in (args or {}).items():
        if isinstance(v, str) and len(v) > 1500:
            out[k] = v[:1500] + f"…[{len(v)} chars]"
        else:
            out[k] = v
    return out


_ = (asyncio, ProviderError)
