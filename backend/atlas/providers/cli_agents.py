"""CLI agent runtimes: Hermes, Claude Code, and OpenAI Codex.

These tools run their own agent loop with their own sign-in (subscription or API key).
ATLAS supervises them: it chooses the working directory (an isolated git worktree), restricts
their tools/sandbox, streams their JSONL events into the ATLAS event log, and computes the
resulting diff itself rather than trusting the CLI's report.
"""
from __future__ import annotations

import asyncio
import base64
import json
import mimetypes
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

from ..config import bin_dir
from .base import ChatResult, ModelInfo, Provider, ProviderError, TokenCallback

EventCallback = Callable[[str, Dict[str, Any]], Awaitable[None]]

SEARCH_DIRS = [
    "~/.local/bin", "~/.claude/local", "/opt/homebrew/bin", "/usr/local/bin", "~/.npm-global/bin",
    "~/.bun/bin", "~/.volta/bin", "~/.nvm/current/bin",
]


def find_binary(name: str, configured: Optional[str] = None) -> Optional[str]:
    if configured and Path(configured).expanduser().exists():
        return str(Path(configured).expanduser())
    found = shutil.which(name)
    if found:
        return found
    for d in SEARCH_DIRS + [str(bin_dir())]:
        p = Path(d).expanduser() / name
        if p.exists():
            return str(p)
    nvm = Path("~/.nvm/versions/node").expanduser()
    if nvm.exists():
        for v in sorted(nvm.iterdir(), reverse=True):
            p = v / "bin" / name
            if p.exists():
                return str(p)
    return None


STRIP_PREFIXES = {
    "claude": ("ANTHROPIC_", "CLAUDECODE", "CLAUDE_CODE_", "CLAUDE_AGENT_SDK"),
    "codex": ("OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_"),
}


def cli_env(binary: str, use_env_auth: bool = False) -> Dict[str, str]:
    """Environment for a CLI agent. By default inherited API keys/session vars are removed so the
    CLI uses its own sign-in (subscription) instead of whatever the launching process exported."""
    env = dict(os.environ)
    name = Path(binary).name
    if not use_env_auth and name in STRIP_PREFIXES:
        for k in list(env):
            if k.startswith(STRIP_PREFIXES[name]):
                env.pop(k)
    dirs = [str(Path(binary).parent)] + [str(Path(d).expanduser()) for d in SEARCH_DIRS]
    env["PATH"] = ":".join(dirs + [env.get("PATH", "/usr/bin:/bin")])
    return env


class CLIAgentProvider(Provider):
    agentic = True
    binary_name = ""

    def __init__(self, row, secret=None):
        super().__init__(row, secret)
        self.procs: Dict[str, asyncio.subprocess.Process] = {}

    @property
    def binary(self) -> Optional[str]:
        return find_binary(self.binary_name, self.config.get("binary"))

    def tool_support(self, model: str) -> Optional[bool]:
        return True

    async def health(self) -> Dict[str, Any]:
        b = self.binary
        if not b:
            return {"ok": False, "error": f"`{self.binary_name}` CLI not found. Install it or set its path in the provider settings."}
        p = None
        try:
            p = await asyncio.create_subprocess_exec(b, "--version", stdout=asyncio.subprocess.PIPE,
                                                     stderr=asyncio.subprocess.STDOUT, env=cli_env(b, bool(self.config.get("use_env_auth"))))
            out, _ = await asyncio.wait_for(p.communicate(), 20)
            if p.returncode != 0:
                return {"ok": False, "error": out.decode(errors="replace")[:300]}
            return {"ok": True, "version": out.decode().strip().splitlines()[0] if out else "", "binary": b}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": f"{e.__class__.__name__}: {e}"}
        finally:
            if p is not None and p.returncode is None:
                await self._kill(p)
                await p.communicate()

    async def _stream(self, run_id: str, argv: List[str], cwd: str, stdin_text: str,
                      on_line: Callable[[Dict[str, Any]], Awaitable[None]], timeout: float) -> int:
        b = argv[0]
        proc = await asyncio.create_subprocess_exec(
            *argv, cwd=cwd, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, env=cli_env(b, bool(self.config.get("use_env_auth"))), limit=16 * 1024 * 1024)
        self.procs[run_id] = proc
        stderr_buf: List[str] = []

        async def read_err():
            assert proc.stderr
            async for line in proc.stderr:
                stderr_buf.append(line.decode(errors="replace"))
                del stderr_buf[:-40]

        err_task = asyncio.ensure_future(read_err())
        try:
            assert proc.stdin and proc.stdout
            proc.stdin.write(stdin_text.encode())
            await proc.stdin.drain()
            proc.stdin.close()

            async def read_out():
                async for raw in proc.stdout:  # type: ignore[union-attr]
                    line = raw.decode(errors="replace").strip()
                    if not line:
                        continue
                    try:
                        await on_line(json.loads(line))
                    except ValueError:
                        await on_line({"type": "_text", "text": line})

            await asyncio.wait_for(read_out(), timeout)
            rc = await proc.wait()
        except (asyncio.CancelledError, Exception):
            await self._kill(proc)
            raise
        finally:
            self.procs.pop(run_id, None)
            err_task.cancel()
        if rc != 0:
            raise ProviderError(f"{self.binary_name} exited with code {rc}: {''.join(stderr_buf)[-800:]}", retryable=False)
        return rc

    @staticmethod
    async def _kill(proc: asyncio.subprocess.Process) -> None:
        if proc.returncode is None:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), 5)
            except asyncio.TimeoutError:
                proc.kill()

    async def cancel(self, run_id: str) -> None:
        p = self.procs.get(run_id)
        if p:
            await self._kill(p)

    async def run_agent(self, *, run_id: str, prompt: str, system: str, cwd: str, model: Optional[str],
                        permissions: Dict[str, Any], on_event: EventCallback, timeout: float) -> Dict[str, Any]:
        raise NotImplementedError


class HermesProvider(CLIAgentProvider):
    """Atlas's adapter for the Hermes agent runtime and its JSONL tool stream."""
    kind = "hermes_cli"
    binary_name = "hermes"

    async def list_models(self) -> List[ModelInfo]:
        configured = self.config.get("models") or []
        names = list(dict.fromkeys(n for n in configured if isinstance(n, str) and n.strip() and n != "default"))
        return [ModelInfo(name=name, provider_id=self.id,
                          capabilities={"tools": True, "streaming": True, "agentic": True},
                          details={"display_name": name,
                                   "description": "Hermes agent runtime with web search and project tools."},
                          state="available") for name in names]

    def _base(self, model: Optional[str], cwd: str, toolsets: str, image: Optional[str] = None) -> List[str]:
        binary = self.binary
        if not binary:
            raise ProviderError("Atlas runtime is unavailable: Hermes CLI was not found.", retryable=False)
        argv = [binary, "chat", "--query-file", "-", "--oneshot", "--format", "stream-json",
                "--source", "tool", "--in", cwd, "-t", toolsets]
        if model and model != "default":
            argv += ["--model", model]
        if image:
            argv += ["--image", image]
        return argv

    async def _run(self, run_id: str, cwd: str, prompt: str, model: Optional[str], toolsets: str,
                   on_event: Optional[EventCallback], on_token: TokenCallback, timeout: float,
                   reasoning: Optional[str] = None, image: Optional[str] = None,
                   max_turns: Optional[int] = None) -> Dict[str, Any]:
        argv = self._base(model, cwd, toolsets, image)
        if max_turns and max_turns > 0:
            argv += ["--max-turns", str(max_turns)]
        if reasoning in ("low", "medium", "high", "xhigh"):
            argv += ["--reasoning", reasoning]
        final: Dict[str, Any] = {"text": "", "usage": {}}
        streamed: List[str] = []
        got_result = False

        async def on_line(event: Dict[str, Any]) -> None:
            nonlocal got_result
            kind = event.get("type")
            if kind == "text":
                piece = str(event.get("text") or "")
                streamed.append(piece)
                if on_token and piece:
                    await on_token(piece)
            elif kind == "tool_use" and on_event:
                await on_event("tool_call", {"id": event.get("tool_call_id"), "tool": event.get("name"),
                                             "args": event.get("input") or {}, "runtime": "atlas"})
            elif kind == "tool_result" and on_event:
                await on_event("tool_result", {"id": event.get("tool_call_id"), "tool": event.get("name"),
                                               "output": event.get("output") or "", "ms": event.get("duration_ms"),
                                               "is_error": bool(event.get("is_error")), "runtime": "atlas"})
            elif kind == "result":
                got_result = True
                final["text"] = str(event.get("text") or "".join(streamed)).strip()
                tokens = event.get("tokens") or {}
                final["usage"] = {"prompt_tokens": tokens.get("input") or 0,
                                  "completion_tokens": tokens.get("output") or 0, "measured": True}
                if event.get("exit_code") or event.get("error"):
                    raise ProviderError(f"Atlas runtime failed: {event.get('error') or 'exit code ' + str(event.get('exit_code'))}",
                                        retryable=False)

        await self._stream(run_id, argv, cwd, prompt, on_line, timeout)
        if not got_result or not final["text"]:
            raise ProviderError("Atlas runtime ended without a final answer.", retryable=False)
        return final

    async def chat(self, model, messages, *, tools=None, params=None, on_token: TokenCallback = None, json_mode=False):
        image_files: List[Path] = []
        message_text: List[str] = []
        with tempfile.TemporaryDirectory(prefix="atlas-chat-images-") as image_dir:
            for message in messages:
                content = message.get("content") or ""
                if not isinstance(content, list):
                    message_text.append(f"[{message['role']}]\n{content}")
                    continue
                text_blocks = []
                for block in content:
                    if block.get("type") == "text":
                        text_blocks.append(str(block.get("text") or ""))
                    elif block.get("type") == "image" and block.get("data"):
                        mime = str(block.get("mime_type") or "image/png")
                        suffix = mimetypes.guess_extension(mime) or ".png"
                        path = Path(image_dir) / f"image-{len(image_files) + 1}{suffix}"
                        try:
                            path.write_bytes(base64.b64decode(block["data"], validate=True))
                        except (ValueError, OSError) as exc:
                            raise ProviderError("Atlas could not prepare the attached image.", retryable=False) from exc
                        image_files.append(path)
                        text_blocks.append(f"[Attached image {block.get('name') or path.name}: {path}]")
                message_text.append(f"[{message['role']}]\n" + "\n".join(text_blocks))
            prompt = "\n\n".join(message_text)
            if len(image_files) > 1:
                prompt += "\n\nAdditional attached images are available at the paths listed above. Inspect them with vision tools."
            cwd = str(Path.home())
            started = time.perf_counter()
            result = await self._run(f"chat-{time.time()}", cwd, prompt, model, "web,search,vision",
                                     None, on_token, float((params or {}).get("timeout", 600)),
                                     (params or {}).get("reasoning_effort"),
                                     str(image_files[0]) if image_files else None)
        return ChatResult(text=result["text"], usage=result["usage"],
                          latency_ms=(time.perf_counter() - started) * 1000)

    async def run_agent(self, *, run_id, prompt, system, cwd, model, permissions, on_event, timeout):
        # Read-only tasks still need Hermes' file toolset to inspect project files.
        # Keep terminal access to the coding posture, where runs use an isolated workspace.
        toolsets = "coding" if permissions.get("write") else "file,web,vision"
        full_prompt = f"{system}\n\n{prompt}" if system else prompt
        return await self._run(run_id, cwd, full_prompt, model, toolsets, on_event, None, timeout,
                               permissions.get("reasoning_effort"),
                               max_turns=permissions.get("max_steps"))


class ClaudeCodeProvider(CLIAgentProvider):
    kind = "claude_code"
    binary_name = "claude"

    async def list_models(self) -> List[ModelInfo]:
        names = list(dict.fromkeys(["default"] + [n for n in (self.config.get("models") or ["opus", "sonnet", "haiku"]) if isinstance(n, str) and n.strip()]))
        labels = {
            "default": ("Claude Code default", "Use the model selected in Claude Code."),
            "opus": ("Claude Opus", "For complex planning and deeper work."),
            "sonnet": ("Claude Sonnet", "For everyday coding and conversation."),
            "haiku": ("Claude Haiku", "For quick questions and focused tasks."),
        }
        return [ModelInfo(name=n, provider_id=self.id, capabilities={"tools": True, "streaming": True, "agentic": True},
                          details={"display_name": labels.get(n, (n, ""))[0], "description": labels.get(n, (n, ""))[1],
                                   "note": "Alias resolved by Claude Code using your Claude sign-in."}, state="available")
                for n in names]

    def _base(self, model: Optional[str]) -> List[str]:
        b = self.binary
        if not b:
            raise ProviderError("Claude Code CLI (`claude`) not found.", retryable=False)
        argv = [b, "-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence"]
        if model and model != "default":
            argv += ["--model", model]
        return argv

    async def chat(self, model, messages, *, tools=None, params=None, on_token: TokenCallback = None, json_mode=False):
        system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
        convo = "\n\n".join(f"[{m['role']}]\n{m.get('content') or ''}" for m in messages if m["role"] != "system")
        argv = self._base(model) + ["--tools", ""]
        if system:
            argv += ["--append-system-prompt", system]
        result = ChatResult()
        t0 = time.perf_counter()

        async def on_line(ev):
            if ev.get("type") == "assistant":
                for block in (ev.get("message") or {}).get("content") or []:
                    if block.get("type") == "text":
                        result.text += block["text"]
                        if on_token:
                            await on_token(block["text"])
            elif ev.get("type") == "result":
                result.usage = {**(ev.get("usage") or {}), "cost_usd": ev.get("total_cost_usd"), "measured": True}
                if ev.get("is_error"):
                    raise ProviderError(f"Claude Code error: {ev.get('result')}")

        await self._stream(f"chat-{time.time()}", argv, os.getcwd() if Path(os.getcwd()).exists() else str(Path.home()),
                           convo, on_line, float((params or {}).get("timeout", 600)))
        result.latency_ms = (time.perf_counter() - t0) * 1000
        return result

    async def run_agent(self, *, run_id, prompt, system, cwd, model, permissions, on_event, timeout):
        argv = self._base(model)
        # Map ATLAS permissions onto Claude Code's own permission system. Headless mode cannot
        # prompt, so anything not allowed here is refused by Claude Code itself.
        allowed = ["Read", "Glob", "Grep", "LS"]
        if permissions.get("write"):
            allowed += ["Edit", "Write", "MultiEdit", "NotebookEdit"]
        for prefix in permissions.get("bash_allowlist") or []:
            allowed.append(f"Bash({prefix}:*)")
        if permissions.get("bash_any"):
            allowed.append("Bash")
        argv += ["--permission-mode", "acceptEdits" if permissions.get("write") else "default",
                 "--allowedTools", ",".join(allowed)]
        if not permissions.get("network"):
            argv += ["--disallowedTools", "WebFetch,WebSearch"]
        if system:
            argv += ["--append-system-prompt", system]
        final: Dict[str, Any] = {"text": "", "usage": {}}

        async def on_line(ev):
            t = ev.get("type")
            if t == "assistant":
                for block in (ev.get("message") or {}).get("content") or []:
                    if block.get("type") == "text" and block.get("text"):
                        await on_event("agent_message", {"text": block["text"]})
                    elif block.get("type") == "tool_use":
                        await on_event("tool_call", {"tool": block.get("name"), "args": block.get("input"), "id": block.get("id"),
                                                      "runtime": "claude_code"})
            elif t == "user":
                for block in (ev.get("message") or {}).get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "tool_result":
                        content = block.get("content")
                        if isinstance(content, list):
                            content = "\n".join(c.get("text", "") for c in content if isinstance(c, dict))
                        await on_event("tool_result", {"id": block.get("tool_use_id"), "output": str(content)[:8000],
                                                        "is_error": bool(block.get("is_error"))})
            elif t == "result":
                final["text"] = ev.get("result") or ""
                final["usage"] = {**(ev.get("usage") or {}), "cost_usd": ev.get("total_cost_usd"),
                                  "duration_ms": ev.get("duration_ms"), "num_turns": ev.get("num_turns")}
                if ev.get("permission_denials"):
                    await on_event("permission_denied", {"denials": ev["permission_denials"]})
                if ev.get("is_error"):
                    raise ProviderError(f"Claude Code reported an error: {final['text'][:500]}", retryable=False)

        await self._stream(run_id, argv, cwd, prompt, on_line, timeout)
        return final


class CodexProvider(CLIAgentProvider):
    kind = "codex_cli"
    binary_name = "codex"

    async def list_models(self) -> List[ModelInfo]:
        def cached_catalog() -> Dict[str, Dict[str, Any]]:
            # Read model metadata only. Never return identity, instructions, or other cache fields.
            path = Path(os.environ.get("CODEX_HOME") or "~/.codex").expanduser() / "models_cache.json"
            try:
                if path.stat().st_size > 10_000_000:
                    return {}
                data = json.loads(path.read_text())
                rows = data.get("models", []) if isinstance(data, dict) else []
                if not isinstance(rows, list):
                    return {}
                catalog = {}
                for row in rows[:100]:
                    if not isinstance(row, dict) or row.get("visibility", "list") != "list":
                        continue
                    name = row.get("slug")
                    if not isinstance(name, str) or not name.strip():
                        continue
                    catalog[name] = {"display_name": str(row.get("display_name") or name)[:128],
                                     "description": str(row.get("description") or "")[:240],
                                     "context_window": row.get("context_window"),
                                     "vision": "image" in (row.get("input_modalities") or [])}
                return catalog
            except (OSError, ValueError, TypeError):
                return {}

        catalog = {} if self.config.get("oss") else await asyncio.to_thread(cached_catalog)
        configured = self.config.get("models") or list(catalog)
        names = list(dict.fromkeys(["default"] + [n for n in configured if isinstance(n, str) and n.strip()]))
        note = "Uses your Codex sign-in." if not self.config.get("oss") else f"Codex --oss via {self.config.get('local_provider', 'ollama')}."
        result = []
        for name in names:
            metadata = catalog.get(name, {})
            context = metadata.get("context_window")
            result.append(ModelInfo(name=name, provider_id=self.id,
                                    context_length=context if isinstance(context, int) and context > 0 else None,
                                    capabilities={"tools": True, "streaming": True, "agentic": True, "vision": bool(metadata.get("vision"))},
                                    details={"note": note, "display_name": "Codex default" if name == "default" else metadata.get("display_name", name),
                                             "description": "Use the model selected in Codex." if name == "default" else metadata.get("description", "")}, state="available"))
        return result

    def _base(self, model: Optional[str], sandbox: str, cwd: str) -> List[str]:
        b = self.binary
        if not b:
            raise ProviderError("Codex CLI (`codex`) not found. Install with `npm i -g @openai/codex`.", retryable=False)
        argv = [b, "exec", "--json", "--skip-git-repo-check", "--ephemeral", "--sandbox", sandbox, "--cd", cwd]
        if model and model != "default":
            argv += ["--model", model]
        if self.config.get("oss"):
            argv += ["--oss", "--local-provider", self.config.get("local_provider", "ollama")]
        return argv + ["-"]

    async def _run(self, run_id, argv, cwd, prompt, on_event: Optional[EventCallback], timeout) -> Dict[str, Any]:
        final: Dict[str, Any] = {"text": "", "usage": {}}

        async def on_line(ev):
            t = ev.get("type", "")
            item = ev.get("item") or {}
            it = item.get("type")
            if t == "item.completed" and it == "agent_message":
                final["text"] = item.get("text", "")
                if on_event:
                    await on_event("agent_message", {"text": item.get("text", "")})
            elif t == "item.started" and it == "command_execution" and on_event:
                await on_event("tool_call", {"tool": "shell", "args": {"command": item.get("command")}, "id": item.get("id"),
                                              "runtime": "codex"})
            elif t == "item.completed" and it == "command_execution" and on_event:
                await on_event("tool_result", {"id": item.get("id"), "output": (item.get("aggregated_output") or "")[:8000],
                                                "exit_code": item.get("exit_code"), "is_error": item.get("exit_code") not in (0, None)})
            elif t == "item.completed" and it == "file_change" and on_event:
                await on_event("file_edit", {"changes": item.get("changes"), "runtime": "codex"})
            elif t == "item.completed" and it in ("mcp_tool_call", "web_search") and on_event:
                await on_event("tool_call", {"tool": it, "args": item, "id": item.get("id"), "runtime": "codex"})
            elif t == "turn.completed":
                final["usage"] = ev.get("usage") or {}
            elif t in ("turn.failed", "error"):
                msg = (ev.get("error") or {}).get("message") if isinstance(ev.get("error"), dict) else ev.get("message")
                raise ProviderError(f"Codex error: {msg}", retryable=False)

        await self._stream(run_id, argv, cwd, prompt, on_line, timeout)
        return final

    async def chat(self, model, messages, *, tools=None, params=None, on_token: TokenCallback = None, json_mode=False):
        prompt = "\n\n".join(f"[{m['role']}]\n{m.get('content') or ''}" for m in messages)
        cwd = str(Path.home())
        t0 = time.perf_counter()
        out = await self._run(f"chat-{time.time()}", self._base(model, "read-only", cwd), cwd, prompt, None,
                              float((params or {}).get("timeout", 600)))
        if on_token and out["text"]:
            await on_token(out["text"])
        return ChatResult(text=out["text"], usage={**out["usage"], "measured": True}, latency_ms=(time.perf_counter() - t0) * 1000)

    async def run_agent(self, *, run_id, prompt, system, cwd, model, permissions, on_event, timeout):
        sandbox = "workspace-write" if permissions.get("write") else "read-only"
        full = (system + "\n\n" + prompt) if system else prompt
        return await self._run(run_id, self._base(model, sandbox, cwd), cwd, full, on_event, timeout)

