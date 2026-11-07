"""Agent tools. Every tool is scoped to one workspace directory and emits inspectable events."""
from __future__ import annotations

import asyncio
import fnmatch
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional
from urllib.parse import urlsplit

from . import extensions, gitops
from .security import (PermissionDenied, classify_command, resolve_in_workspace, sandbox_wrap, scrubbed_env,
                       shell_argv, is_secret_file)

MAX_OUTPUT = 12000
MAX_WRITE_BYTES = 5_000_000
MAX_COMMAND_OUTPUT = 2_000_000
IGNORED_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", "target",
                ".tox", ".mypy_cache", ".pytest_cache", ".idea", ".DS_Store"}

PERMISSION_GROUPS = {
    "read": "Read files, list directories, search",
    "write": "Create and edit files, apply patches",
    "shell": "Run terminal commands and tests (subject to command policy)",
    "git": "Inspect git status/diff/log and commit to the task branch",
    "memory": "Write team and project memory",
    "messages": "Send structured messages to teammates",
    "mcp": "Call authorized MCP integration tools",
    "computer": "Observe and control Mac apps when Atlas Computer Use is enabled",
}


@dataclass
class ToolContext:
    workspace: Path
    permissions: List[str]
    settings: Dict[str, Any]
    request_approval: Callable[[str, Dict[str, Any]], Awaitable[bool]]
    remember: Callable[[str, str, str], Awaitable[None]]
    send_message: Callable[[str, str, Dict[str, Any]], Awaitable[str]]
    mcp_call: Optional[Callable[[str, Dict[str, Any]], Awaitable[str]]] = None
    mcp_tools: List[Dict[str, Any]] = field(default_factory=list)
    files_changed: set = field(default_factory=set)
    commands_run: List[Dict[str, Any]] = field(default_factory=list)
    finished: Optional[Dict[str, Any]] = None
    ask_user: Optional[Callable[[str, List[str]], Awaitable[str]]] = None
    computer_use: Optional[Callable[[str, Dict[str, Any]], Awaitable[Dict[str, Any]]]] = None
    read_roots: List[Path] = field(default_factory=list)   # folders of files the user attached to this run

    def path(self, rel: str) -> Path:
        block = bool(self.settings.get("permissions.block_secret_files", True))
        try:
            return resolve_in_workspace(self.workspace, rel, block_secrets=block)
        except PermissionDenied:
            for root in self.read_roots:
                try:
                    return resolve_in_workspace(root, rel, block_secrets=block)
                except PermissionDenied:
                    continue
            raise

    def rel(self, p: Path) -> str:
        try:
            return str(p.resolve().relative_to(self.workspace.resolve())) or "."
        except ValueError:
            return str(p.resolve())   # an attached file outside the workspace



class ToolError(Exception):
    pass


def _clip(s: str, n: int = MAX_OUTPUT) -> str:
    return s if len(s) <= n else s[: n // 2] + f"\n…[{len(s) - n} chars truncated]…\n" + s[-n // 2:]


# ---------------------------------------------------------------- handlers

async def t_list_dir(ctx: ToolContext, path: str = ".", depth: int = 2) -> str:
    root = ctx.path(path)
    if not root.is_dir():
        raise ToolError(f"{path} is not a directory")
    lines: List[str] = []
    depth = max(1, min(int(depth), 5))

    def walk(d: Path, level: int):
        try:
            entries = sorted(d.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except PermissionError:
            return
        for e in entries:
            if e.name in IGNORED_DIRS:
                continue
            lines.append("  " * level + e.name + ("/" if e.is_dir() else ""))
            if len(lines) > 400:
                return
            if e.is_dir() and level + 1 < depth:
                walk(e, level + 1)

    walk(root, 0)
    return "\n".join(lines) or "(empty)"


async def t_read_file(ctx: ToolContext, path: str, start_line: int = 1, end_line: int = 0) -> str:
    p = ctx.path(path)
    if not p.is_file():
        raise ToolError(f"{path} does not exist or is not a file")
    if p.stat().st_size > 2_000_000:
        raise ToolError("File is larger than 2 MB; read a line range or search instead.")
    text = p.read_text(errors="replace").splitlines()
    s = max(1, int(start_line or 1))
    e = int(end_line or 0) or min(len(text), s + 399)
    body = "\n".join(f"{i:>5}  {line}" for i, line in enumerate(text[s - 1:e], start=s))
    more = f"\n… ({len(text) - e} more lines)" if e < len(text) else ""
    return f"{ctx.rel(p)} (lines {s}-{min(e, len(text))} of {len(text)})\n{body}{more}"


async def t_search(ctx: ToolContext, pattern: str, glob: str = "", max_results: int = 80) -> str:
    try:
        rx = re.compile(pattern)
    except re.error as e:
        raise ToolError(f"Invalid regex: {e}")
    results: List[str] = []
    root = ctx.workspace.resolve()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS]
        for fn in filenames:
            if glob and not fnmatch.fnmatch(fn, glob):
                continue
            fp = Path(dirpath) / fn
            if is_secret_file(fp):
                continue
            try:
                if fp.stat().st_size > 1_000_000:
                    continue
                with open(fp, "r", errors="strict") as f:
                    for i, line in enumerate(f, 1):
                        if rx.search(line):
                            results.append(f"{fp.relative_to(root)}:{i}: {line.rstrip()[:240]}")
                            if len(results) >= max_results:
                                return "\n".join(results) + "\n… (limit reached)"
            except (UnicodeDecodeError, OSError):
                continue
    return "\n".join(results) or "No matches."


async def t_write_file(ctx: ToolContext, path: str, content: str) -> str:
    if len(content) > MAX_WRITE_BYTES:
        raise ToolError(f"Content larger than {MAX_WRITE_BYTES // 1_000_000} MB; refusing.")
    p = ctx.path(path)
    existed = p.exists()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    ctx.files_changed.add(ctx.rel(p))
    return f"{'Updated' if existed else 'Created'} {ctx.rel(p)} ({len(content.splitlines())} lines)"


async def t_edit_file(ctx: ToolContext, path: str, old_text: str, new_text: str, replace_all: bool = False) -> str:
    if not old_text:
        raise ToolError("old_text must not be empty. To add new content, include an existing line as old_text "
                        "and repeat it in new_text with your addition, or use write_file.")
    p = ctx.path(path)
    if not p.is_file():
        raise ToolError(f"{path} does not exist")
    src = p.read_text()
    n = src.count(old_text)
    if n == 0:
        raise ToolError("old_text not found. Read the file again and copy the exact text, including indentation.")
    if n > 1 and not replace_all:
        raise ToolError(f"old_text occurs {n} times; include more surrounding context or set replace_all.")
    out = src.replace(old_text, new_text) if replace_all else src.replace(old_text, new_text, 1)
    if len(out) > MAX_WRITE_BYTES:
        raise ToolError(f"Edit would make the file larger than {MAX_WRITE_BYTES // 1_000_000} MB; refusing.")
    p.write_text(out)
    ctx.files_changed.add(ctx.rel(p))
    return f"Edited {ctx.rel(p)} ({n if replace_all else 1} replacement)"


async def t_apply_patch(ctx: ToolContext, patch: str) -> str:
    for m in re.finditer(r"^(?:\+\+\+|---) (?:[ab]/)?(\S+)", patch, re.M):
        if m.group(1) != "/dev/null":
            ctx.path(m.group(1))  # boundary check for every target
    with tempfile.NamedTemporaryFile("w", suffix=".patch", delete=False) as f:
        f.write(patch)
        pf = f.name
    try:
        r = subprocess.run(["git", "apply", "--whitespace=nowarn", "--recount", pf], cwd=str(ctx.workspace),
                           capture_output=True, text=True)
        if r.returncode != 0:
            raise ToolError(f"Patch failed: {r.stderr.strip()}")
        for m in re.finditer(r"^\+\+\+ (?:b/)?(\S+)", patch, re.M):
            if m.group(1) != "/dev/null":
                ctx.files_changed.add(m.group(1))
        return "Patch applied."
    finally:
        os.unlink(pf)


async def t_run_command(ctx: ToolContext, command: str, timeout_s: int = 0) -> str:
    policy = ctx.settings.get("permissions.command_policy", "ask")
    decision, reason = classify_command(command, policy, ctx.settings.get("permissions.allowlist") or [], bool(ctx.settings.get("_auto_approve")),
                                       ctx.settings.get("permissions.always_allow") or [], bool(ctx.settings.get("_git_requested")))
    if decision == "deny":
        raise PermissionDenied(reason)
    if decision == "ask":
        ok = await ctx.request_approval("command", {"command": command, "reason": reason, "cwd": str(ctx.workspace)})
        if not ok:
            raise PermissionDenied("The user declined this command.")
    timeout = int(timeout_s or ctx.settings.get("execution.command_timeout_s", 120))
    argv = shell_argv(command)
    if ctx.settings.get("execution.sandbox_commands", True):
        argv = sandbox_wrap(argv, ctx.workspace, bool(ctx.settings.get("execution.allow_network_in_commands", True)))
    proc = await asyncio.create_subprocess_exec(*argv, cwd=str(ctx.workspace), stdout=asyncio.subprocess.PIPE,
                                                stderr=asyncio.subprocess.STDOUT, env=scrubbed_env(),
                                                start_new_session=True)
    async def bounded_read() -> bytes:
        buf = bytearray()
        assert proc.stdout
        while True:
            chunk = await proc.stdout.read(65536)
            if not chunk:
                break
            if len(buf) < MAX_COMMAND_OUTPUT:
                buf.extend(chunk[: MAX_COMMAND_OUTPUT - len(buf)])
        await proc.wait()
        return bytes(buf)

    try:
        out = await asyncio.wait_for(bounded_read(), timeout)
        code = proc.returncode
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        out, code = b"", -1
        ctx.commands_run.append({"command": command, "exit_code": None, "timed_out": True})
        raise ToolError(f"Command timed out after {timeout}s")
    except asyncio.CancelledError:
        proc.kill()
        raise
    ctx.commands_run.append({"command": command, "exit_code": code})
    text = out.decode(errors="replace")
    for line in gitops.status(ctx.workspace) if gitops.is_repo(ctx.workspace) else []:
        ctx.files_changed.add(line["path"])
    return f"$ {command}\n(exit code {code})\n{_clip(text)}"


async def t_git(ctx: ToolContext, action: str, message: str = "", ref: str = "") -> str:
    if not gitops.is_repo(ctx.workspace):
        raise ToolError("Workspace is not a git repository.")
    if action == "status":
        return "\n".join(f"{s['code']} {s['path']}" for s in gitops.status(ctx.workspace)) or "Clean."
    if action == "diff":
        return _clip(gitops.working_diff(ctx.workspace) or "No changes.")
    if action == "log":
        return "\n".join(f"{c['sha'][:8]} {c['subject']} ({c['when']})" for c in gitops.log(ctx.workspace, 15))
    if action == "show":
        return _clip(gitops.git(ctx.workspace, "show", "--stat", "--patch", ref or "HEAD", check=False))
    if action == "commit":
        branch = gitops.current_branch(ctx.workspace)
        # commits ask unless the user's message asked for git work
        if not ctx.settings.get("_git_requested"):
            ok = await ctx.request_approval("git_commit", {"branch": branch, "message": message})
            if not ok:
                raise PermissionDenied("Commit outside an ATLAS task branch was declined.")
        sha = gitops.commit_all(ctx.workspace, message or "ATLAS agent changes")
        return f"Committed {sha[:8]}" if sha else "Nothing to commit."
    raise ToolError("action must be one of: status, diff, log, show, commit")


async def t_remember(ctx: ToolContext, scope: str, key: str, content: str) -> str:
    if scope not in ("team", "project"):
        raise ToolError("scope must be 'team' or 'project'")
    await ctx.remember(scope, key, content)
    return f"Saved to {scope} memory as unverified note '{key}'."


async def t_send_message(ctx: ToolContext, to_role: str, type: str, content: str) -> str:
    mid = await ctx.send_message(to_role, type, {"content": content})
    return f"Message {mid} delivered to {to_role}."


async def t_finish(ctx: ToolContext, summary: str, status: str = "completed", verification: str = "") -> str:
    ctx.finished = {"summary": summary, "status": status if status in ("completed", "failed", "blocked") else "completed",
                    "verification": verification}
    return "Task marked finished."


async def t_ask_user(ctx: ToolContext, question: str, choices: Optional[List[str]] = None) -> str:
    if not ctx.ask_user:
        raise ToolError("Questions are unavailable for this run.")
    question = str(question or "").strip()
    if not question or len(question) > 1000:
        raise ToolError("question must contain 1 to 1000 characters.")
    if choices is not None and not isinstance(choices, list):
        raise ToolError("choices must be a list of up to 8 short strings.")
    if len(choices or []) > 8:
        raise ToolError("choices is limited to 8 entries.")
    choices = [str(x).strip()[:160] for x in (choices or []) if str(x).strip()][:8]
    return await ctx.ask_user(question, choices)


async def _computer(ctx: ToolContext, action: str, args: Dict[str, Any]) -> Dict[str, Any]:
    if not ctx.computer_use:
        raise ToolError("Atlas Computer Use is not enabled for this chat.")
    return await ctx.computer_use(action, args)


async def t_computer_capture(ctx: ToolContext) -> Dict[str, Any]:
    return await _computer(ctx, "capture", {})


async def t_computer_open_preview(ctx: ToolContext, url: str) -> Dict[str, Any]:
    parsed = urlsplit(str(url or ""))
    if parsed.scheme != "http" or (parsed.hostname or "").lower() not in ("localhost", "127.0.0.1", "::1") or parsed.username or parsed.password:
        raise ToolError("Only local http://localhost preview URLs can be opened by this tool.")
    return await _computer(ctx, "open_preview", {"url": url[:2000]})


async def t_computer_click(ctx: ToolContext, x: float, y: float, button: str = "left") -> Dict[str, Any]:
    return await _computer(ctx, "click", {"x": x, "y": y, "button": button})


async def t_computer_type(ctx: ToolContext, text: str) -> Dict[str, Any]:
    if len(text) > 1000:
        raise ToolError("Text entry is limited to 1000 characters per action.")
    return await _computer(ctx, "type", {"text": text})


async def t_computer_key(ctx: ToolContext, key: str) -> Dict[str, Any]:
    return await _computer(ctx, "key", {"key": key})


async def t_computer_scroll(ctx: ToolContext, x: float, y: float, delta_y: int) -> Dict[str, Any]:
    return await _computer(ctx, "scroll", {"x": x, "y": y, "delta_y": delta_y})


async def t_skill(ctx: ToolContext, name: str) -> str:
    body = extensions.read_skill(ctx.settings, name)
    if body is None:
        names = ", ".join(s["name"] for s in extensions.list_skills(ctx.settings)) or "none installed"
        raise ToolError(f"No skill named '{name}'. Available: {names}")
    return _clip(body)


async def t_mcp(ctx: ToolContext, tool: str, arguments: Optional[Dict[str, Any]] = None) -> str:
    if not ctx.mcp_call:
        raise ToolError("No MCP servers are configured.")
    ok = await ctx.request_approval("mcp", {"tool": tool, "arguments": arguments or {}})
    if not ok:
        raise PermissionDenied("MCP call declined.")
    return _clip(await ctx.mcp_call(tool, arguments or {}))


def _obj(props: Dict[str, Any], required: List[str]) -> Dict[str, Any]:
    return {"type": "object", "properties": props, "required": required}


S = {"type": "string"}
I = {"type": "integer"}
B = {"type": "boolean"}

TOOLS: List[Dict[str, Any]] = [
    {"name": "list_dir", "group": "read", "handler": t_list_dir,
     "description": "List files and folders (relative to the workspace).",
     "parameters": _obj({"path": S, "depth": I}, [])},
    {"name": "read_file", "group": "read", "handler": t_read_file,
     "description": "Read a text file with line numbers. Optional 1-based line range.",
     "parameters": _obj({"path": S, "start_line": I, "end_line": I}, ["path"])},
    {"name": "search", "group": "read", "handler": t_search,
     "description": "Regex search across workspace files. Optional filename glob like '*.py'.",
     "parameters": _obj({"pattern": S, "glob": S}, ["pattern"])},
    {"name": "write_file", "group": "write", "handler": t_write_file,
     "description": "Create or overwrite a file with full content.",
     "parameters": _obj({"path": S, "content": S}, ["path", "content"])},
    {"name": "edit_file", "group": "write", "handler": t_edit_file,
     "description": "Replace exact text in a file. old_text must match exactly once unless replace_all.",
     "parameters": _obj({"path": S, "old_text": S, "new_text": S, "replace_all": B}, ["path", "old_text", "new_text"])},
    {"name": "apply_patch", "group": "write", "handler": t_apply_patch,
     "description": "Apply a unified diff (git format) to the workspace.",
     "parameters": _obj({"patch": S}, ["patch"])},
    {"name": "run_command", "group": "shell", "handler": t_run_command,
     "description": "Run a shell command in the workspace (tests, builds, linters). Subject to approval policy.",
     "parameters": _obj({"command": S, "timeout_s": I}, ["command"])},
    {"name": "git", "group": "git", "handler": t_git,
     "description": "Git operations on the workspace: action = status | diff | log | show | commit.",
     "parameters": _obj({"action": S, "message": S, "ref": S}, ["action"])},
    {"name": "remember", "group": "memory", "handler": t_remember,
     "description": "Store a finding or decision in team or project memory (scope: team|project).",
     "parameters": _obj({"scope": S, "key": S, "content": S}, ["scope", "key", "content"])},
    {"name": "send_message", "group": "messages", "handler": t_send_message,
     "description": "Send a structured message to a teammate by role. type: status_update | context_request | "
                    "research_finding | artifact_handoff | review_request | blocker_notification.",
     "parameters": _obj({"to_role": S, "type": S, "content": S}, ["to_role", "type", "content"])},
    {"name": "skill", "group": "read", "handler": t_skill,
     "description": "Load an installed skill's full instructions by name, then follow them.",
     "parameters": _obj({"name": S}, ["name"])},
    {"name": "mcp", "group": "mcp", "handler": t_mcp,
     "description": "Call an authorized MCP integration tool by its qualified name (server/tool).",
     "parameters": _obj({"tool": S, "arguments": {"type": "object"}}, ["tool"])},
    {"name": "ask_user", "group": None, "handler": t_ask_user,
     "description": "Pause and ask the user for missing context. Use only when their answer is needed to continue.",
     "parameters": _obj({"question": S, "choices": {"type": "array", "items": S, "maxItems": 8}}, ["question"])},
    {"name": "computer_capture", "group": "computer", "handler": t_computer_capture,
     "description": "Capture the current visible Mac screen. Returns an ephemeral screenshot for visual analysis.",
     "parameters": _obj({}, [])},
    {"name": "computer_open_preview", "group": "computer", "handler": t_computer_open_preview,
     "description": "Open a local http://localhost build preview in the default browser.",
     "parameters": _obj({"url": S}, ["url"])},
    {"name": "computer_click", "group": "computer", "handler": t_computer_click,
     "description": "Click a visible point on screen coordinates returned by computer_capture.",
     "parameters": _obj({"x": {"type": "number"}, "y": {"type": "number"}, "button": S}, ["x", "y"])},
    {"name": "computer_type", "group": "computer", "handler": t_computer_type,
     "description": "Type text into the currently focused control (maximum 1000 characters).",
     "parameters": _obj({"text": S}, ["text"])},
    {"name": "computer_key", "group": "computer", "handler": t_computer_key,
     "description": "Press a supported key or modifier chord, such as ENTER, TAB, ESC, or CMD+L.",
     "parameters": _obj({"key": S}, ["key"])},
    {"name": "computer_scroll", "group": "computer", "handler": t_computer_scroll,
     "description": "Scroll a visible screen region.",
     "parameters": _obj({"x": {"type": "number"}, "y": {"type": "number"}, "delta_y": I}, ["x", "y", "delta_y"])},
    {"name": "finish", "group": None, "handler": t_finish,
     "description": "Call when the task is done. Give a factual summary of what changed and how it was verified. "
                    "status: completed | failed | blocked.",
     "parameters": _obj({"summary": S, "status": S, "verification": S}, ["summary"])},
]

TOOL_MAP = {t["name"]: t for t in TOOLS}


def tools_for(permissions: List[str], has_mcp: bool, has_skills: bool = False,
              has_user_questions: bool = False, has_computer_use: bool = False) -> List[Dict[str, Any]]:
    out = []
    for t in TOOLS:
        if t["group"] is None or t["group"] in permissions:
            if t["name"] == "mcp" and not has_mcp:
                continue
            if t["name"] == "skill" and not has_skills:
                continue
            if t["name"] == "ask_user" and not has_user_questions:
                continue
            if t["group"] == "computer" and not has_computer_use:
                continue
            out.append(t)
    return out


async def execute(ctx: ToolContext, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    t = TOOL_MAP.get(name)
    if not t:
        return {"ok": False, "output": f"Unknown tool '{name}'. Available: {', '.join(TOOL_MAP)}"}
    if t["group"] is not None and t["group"] not in ctx.permissions:
        return {"ok": False, "output": f"Permission denied: this agent lacks the '{t['group']}' permission."}
    allowed = set(t["parameters"]["properties"].keys())
    clean = {k: v for k, v in (args or {}).items() if k in allowed}
    missing = [r for r in t["parameters"]["required"] if r not in clean]
    if missing:
        return {"ok": False, "output": f"Missing required argument(s): {', '.join(missing)}"}
    try:
        blocked = await extensions.run_hooks("PreToolUse", name, clean, None, ctx.workspace, ctx.settings)
        if blocked:
            return {"ok": False, "output": f"Blocked by a PreToolUse hook: {blocked}", "denied": True}
        output = await t["handler"](ctx, **clean)
        if isinstance(output, dict) and "output" in output:
            await extensions.run_hooks("PostToolUse", name, clean, str(output["output"])[:4000], ctx.workspace, ctx.settings)
            return {"ok": True, **output, "output": str(output["output"])}
        await extensions.run_hooks("PostToolUse", name, clean, str(output)[:4000], ctx.workspace, ctx.settings)
        return {"ok": True, "output": output}
    except PermissionDenied as e:
        return {"ok": False, "output": f"Permission denied: {e}", "denied": True}
    except (ToolError, gitops.GitError) as e:
        return {"ok": False, "output": str(e)}
    except TypeError as e:
        return {"ok": False, "output": f"Bad arguments: {e}"}
    except asyncio.CancelledError:
        raise
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "output": f"{e.__class__.__name__}: {e}"}
