"""Conversations: the chat-first front door to the harness.

A message is answered in one of three ways, chosen by the composer:
  * model  — streamed directly from a provider (Ollama, MLX, llama.cpp, Claude, Codex, ...).
             If agent tools are selected, the turn runs as a task for the "Atlas Assistant"
             agent bound to that model, so file/terminal access goes through the normal
             sandbox, command policy and approvals.
  * agent  — a task for an existing agent (narrowed by the selected tools).
  * team   — an objective for a team; the lead plans and delegates.
Agent/team turns link the assistant message to the task; the UI renders its execution
panel and the final result is copied into the message when the task finishes.
"""
from __future__ import annotations

import asyncio
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import extensions
from .db import DB, new_id, now
from .events import EventBus
from .orchestrator import TERMINAL, Orchestrator
from .providers import ModelRouter, ProviderError

AGENT_TOOL_GROUPS = ("read", "write", "shell", "git", "memory", "mcp")
HISTORY_MESSAGES = 24
MAX_ATTACHMENT_CHARS = 200_000
MAX_IMAGE_CHARS = 6_000_000
DEFAULT_TITLE = "New chat"


class ChatError(Exception):
    pass


class ChatService:
    def __init__(self, db: DB, bus: EventBus, router: ModelRouter, orch: Orchestrator):
        self.db, self.bus, self.router, self.orch = db, bus, router, orch
        self.streams: Dict[str, asyncio.Task] = {}   # assistant message id -> streaming task
        self.watchers: Dict[str, asyncio.Task] = {}  # assistant message id -> task watcher

    # ------------------------------------------------------------------ lifecycle
    def recover(self) -> None:
        for m in self.db.q("SELECT * FROM chat_messages WHERE status='streaming'"):
            self.db.update("chat_messages", m["id"], {"status": "error",
                                                       "content": (m["content"] or "") + "\n\n_Interrupted by restart._"})
        for m in self.db.q("SELECT * FROM chat_messages WHERE status='running' AND task_id IS NOT NULL"):
            self._watch(m["id"], m["conversation_id"], m["task_id"])

    async def stop_all(self) -> None:
        for t in list(self.streams.values()) + list(self.watchers.values()):
            t.cancel()

    # ------------------------------------------------------------------ conversations
    def create(self, title: Optional[str] = None, config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        t = now()
        conv = self.db.insert("conversations", {"id": new_id("chat"), "title": (title or DEFAULT_TITLE)[:120],
                                                "config": config or {}, "created_at": t, "updated_at": t})
        self.bus.changed("conversation", conv["id"])
        return conv

    def get(self, cid: str) -> Dict[str, Any]:
        conv = self.db.get("conversations", cid)
        if not conv:
            raise KeyError("conversation not found")
        return conv

    def view(self, cid: str) -> Dict[str, Any]:
        conv = self.get(cid)
        conv["messages"] = self.db.q("SELECT * FROM chat_messages WHERE conversation_id=? ORDER BY created_at, rowid", (cid,))
        return conv

    def list(self, q: str = "", limit: int = 300) -> List[Dict[str, Any]]:
        if q.strip():
            like = f"%{q.strip()}%"
            return self.db.q(
                "SELECT c.* FROM conversations c WHERE c.title LIKE ? OR EXISTS ("
                "SELECT 1 FROM chat_messages m WHERE m.conversation_id=c.id AND m.content LIKE ?) "
                "ORDER BY c.updated_at DESC LIMIT ?", (like, like, limit))
        return self.db.q("SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?", (limit,))

    def patch(self, cid: str, body: Dict[str, Any]) -> Dict[str, Any]:
        conv = self.get(cid)
        upd: Dict[str, Any] = {}
        if "title" in body and str(body["title"]).strip():
            upd["title"] = str(body["title"]).strip()[:120]
        if isinstance(body.get("config"), dict):
            upd["config"] = {**(conv["config"] or {}), **body["config"]}
        if upd:
            conv = self.db.update("conversations", cid, upd)
            self.bus.changed("conversation", cid)
        return conv

    def delete(self, cid: str) -> None:
        self.get(cid)
        for m in self.db.q("SELECT id FROM chat_messages WHERE conversation_id=?", (cid,)):
            for reg in (self.streams, self.watchers):
                t = reg.pop(m["id"], None)
                if t:
                    t.cancel()
        self.db.x("DELETE FROM chat_messages WHERE conversation_id=?", (cid,))
        self.db.delete("conversations", cid)
        self.bus.changed("conversation", cid)

    def stop(self, cid: str) -> None:
        for m in self.db.q("SELECT * FROM chat_messages WHERE conversation_id=? AND status IN ('streaming','running')", (cid,)):
            t = self.streams.pop(m["id"], None)
            if t:
                t.cancel()
            if m.get("task_id"):
                self.orch.cancel(m["task_id"], "Stopped from chat")

    # ------------------------------------------------------------------ sending
    def send(self, cid: str, content: str, attachments: Optional[List[Dict[str, Any]]] = None,
             config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        conv = self.get(cid)
        content = (content or "").strip()
        attachments = [a for a in (attachments or []) if isinstance(a, dict) and a.get("name")]
        if not content and not attachments:
            raise ChatError("Message is empty.")
        for a in attachments:
            a["type"] = str(a.get("type") or "text/plain")
            limit = MAX_IMAGE_CHARS if a["type"].startswith("image/") else MAX_ATTACHMENT_CHARS
            a["content"] = str(a.get("content") or "")[:limit]
        if self.db.one("SELECT id FROM chat_messages WHERE conversation_id=? AND status IN ('streaming','running')", (cid,)):
            raise ChatError("Atlas is still answering. Stop it or wait before sending another message.")
        cfg = {**(conv["config"] or {}), **(config or {})}
        mode = cfg.get("mode") or "model"
        tools = [t for t in (cfg.get("tools") or []) if isinstance(t, str)]

        t = now()
        user = self.db.insert("chat_messages", {
            "id": new_id("msg"), "conversation_id": cid, "role": "user", "content": content, "status": "done",
            "data": {"attachments": [{"name": a["name"], "size": int(a.get("size") or len(a["content"])), "type": a["type"], "content": a["content"]} for a in attachments],
                     **({"prompt": _with_attachments(content, attachments)} if attachments else {})},
            "created_at": t})
        upd: Dict[str, Any] = {"config": cfg, "updated_at": t}
        if conv["title"] == DEFAULT_TITLE:
            upd["title"] = _title_from(content or attachments[0]["name"])
        self.db.update("conversations", cid, upd)
        prompt = _with_attachments(content, attachments)

        if mode == "team":
            if not cfg.get("team_id") or not self.db.get("teams", cfg["team_id"]):
                raise ChatError("Choose a team in the Agent menu.")
            task = self.orch.submit_objective(cfg["team_id"], self._context_prompt(cid, prompt, user["id"]),
                                              cfg.get("project_id"), _title_from(content or "Objective"))
            label = {"mode": "team", "team_id": cfg["team_id"]}
        elif mode == "agent" or any(g in AGENT_TOOL_GROUPS for g in tools):
            if mode == "agent":
                agent = self.db.get("agents", cfg.get("agent_id") or "")
                if not agent:
                    raise ChatError("Choose an agent in the Agent menu.")
            else:
                agent = self._assistant_agent(cfg)
            task = self.orch.create_task({
                "title": _title_from(content or "Chat request"), "description": self._context_prompt(cid, prompt, user["id"]),
                "agent_id": agent["id"], "team_id": agent.get("team_id"), "project_id": cfg.get("project_id"),
                "kind": "code", "config": {"tool_limit": tools if tools else None, "conversation_id": cid}})
            label = {"mode": "agent", "agent_id": agent["id"], "agent_name": agent["name"]}
        else:
            task = None
            label = {"mode": "model"}

        if task:
            asst = self.db.insert("chat_messages", {
                "id": new_id("msg"), "conversation_id": cid, "role": "assistant", "content": "", "status": "running",
                "task_id": task["id"], "data": label, "created_at": now()})
            self._watch(asst["id"], cid, task["id"])
        else:
            pid, model = cfg.get("provider_id"), cfg.get("model")
            if not pid or not model:
                raise ChatError("Choose a model in the Model menu.")
            if pid not in self.router.providers:
                raise ChatError("That model's provider no longer exists. Choose another model.")
            asst = self.db.insert("chat_messages", {
                "id": new_id("msg"), "conversation_id": cid, "role": "assistant", "content": "", "status": "streaming",
                "data": {"mode": "model", "provider_id": pid, "model": model}, "created_at": now()})
            messages = self._model_messages(cid, cfg, asst["id"])
            self.streams[asst["id"]] = asyncio.ensure_future(self._stream(cid, asst["id"], pid, model, messages, cfg))
        self.bus.changed("conversation", cid)
        return {"user": user, "assistant": asst}

    # ------------------------------------------------------------------ model streaming
    def _model_messages(self, cid: str, cfg: Dict[str, Any], exclude_id: str) -> List[Dict[str, Any]]:
        system = (cfg.get("system") or "").strip() or (
            "You are Atlas, a precise, helpful assistant inside a local multi-agent development harness. "
            "Answer clearly and concisely. Use Markdown for code.")
        if "project" in (cfg.get("tools") or []) and cfg.get("project_id"):
            system += "\n\n" + self._project_context(cfg["project_id"])
        rows = self.db.q("SELECT * FROM chat_messages WHERE conversation_id=? AND id!=? ORDER BY created_at, rowid",
                         (cid, exclude_id))[-HISTORY_MESSAGES:]
        # "/skill-name ..." in the newest user message applies that installed skill for this turn
        newest = next((m["content"] for m in reversed(rows) if m["role"] == "user"), "") or ""
        inv = re.match(r"^/([A-Za-z0-9._-]+)", newest.strip())
        if inv:
            body = extensions.read_skill(self.db.settings(), inv.group(1))
            if body:
                system += f"\n\nThe user invoked the skill '{inv.group(1)}'. Follow these instructions:\n{body}"
        msgs: List[Dict[str, Any]] = [{"role": "system", "content": system}]
        last_user = next((m["id"] for m in reversed(rows) if m["role"] == "user"), None)
        for m in rows:
            if m["role"] == "user":
                # attachments are sent in full only with the newest user turn
                data = m["data"] or {}
                if m["id"] == last_user and data.get("attachments"):
                    msgs.append({"role": "user", "content": _model_attachment_content(m["content"], data["attachments"])})
                else:
                    msgs.append({"role": "user", "content": m["content"]})
            elif m["role"] == "assistant" and m["content"] and m["status"] in ("done", "stopped"):
                msgs.append({"role": "assistant", "content": m["content"]})
        return msgs

    async def _stream(self, cid: str, mid: str, pid: str, model: str, messages: List[Dict[str, Any]],
                      cfg: Dict[str, Any]) -> None:
        buf: List[str] = []
        last_save = time.monotonic()

        async def on_token(tok: str) -> None:
            nonlocal last_save
            buf.append(tok)
            self.bus.broadcast({"kind": "chat_delta", "conversation_id": cid, "message_id": mid, "delta": tok})
            if time.monotonic() - last_save > 2:
                last_save = time.monotonic()
                self.db.update("chat_messages", mid, {"content": "".join(buf)})

        status, extra = "done", {}
        try:
            params = {"temperature": cfg["temperature"]} if cfg.get("temperature") is not None else None
            res = await self.router.chat(pid, model, messages, on_token=on_token, params=params)
            text = "".join(buf) or res.text
            extra = {"usage": res.usage, "latency_ms": res.latency_ms}
        except asyncio.CancelledError:
            text, status = "".join(buf), "stopped"
        except ProviderError as e:
            text, status = "".join(buf), "error"
            extra = {"error": str(e)}
        except Exception as e:  # noqa: BLE001 - surface any provider bug to the user, never hang the turn
            text, status = "".join(buf), "error"
            extra = {"error": f"{type(e).__name__}: {e}"}
        finally:
            self.streams.pop(mid, None)
        cur = self.db.get("chat_messages", mid)
        if cur:
            self.db.update("chat_messages", mid, {"content": text, "status": status, "data": {**(cur["data"] or {}), **extra}})
            self.db.update("conversations", cid, {"updated_at": now()})
            self.bus.broadcast({"kind": "chat_done", "conversation_id": cid, "message_id": mid, "status": status})
            self.bus.changed("conversation", cid)

    # ------------------------------------------------------------------ agent / team turns
    def _watch(self, mid: str, cid: str, task_id: str) -> None:
        async def loop() -> None:
            try:
                while True:
                    await asyncio.sleep(1.0)
                    task = self.db.get("tasks", task_id)
                    msg = self.db.get("chat_messages", mid)
                    if not msg:
                        return
                    if not task:
                        self.db.update("chat_messages", mid, {"status": "error", "content": "The run was deleted."})
                        break
                    if task["status"] in TERMINAL:
                        ok = task["status"] == "completed"
                        if task["status"] == "cancelled":
                            status, text = "stopped", (task.get("result") or "").strip()
                        else:
                            status = "done" if ok else "error"
                            text = (task.get("result") or "").strip() or (task.get("error") or "").strip() or \
                                ("Done." if ok else f"Run {task['status']}.")
                        self.db.update("chat_messages", mid, {"status": status, "content": text})
                        self.db.update("conversations", cid, {"updated_at": now()})
                        break
            finally:
                self.watchers.pop(mid, None)
            self.bus.broadcast({"kind": "chat_done", "conversation_id": cid, "message_id": mid})
            self.bus.changed("conversation", cid)
        self.watchers[mid] = asyncio.ensure_future(loop())

    def _assistant_agent(self, cfg: Dict[str, Any]) -> Dict[str, Any]:
        """The general-purpose agent used when a plain model is given tools. One per model, reused."""
        pid, model = cfg.get("provider_id"), cfg.get("model")
        if not pid or not model:
            raise ChatError("Choose a model in the Model menu.")
        for a in self.db.q("SELECT * FROM agents WHERE provider_id=? AND model=?", (pid, model)):
            if (a.get("config") or {}).get("chat_assistant"):
                return a
        t = now()
        a = self.db.insert("agents", {
            "id": new_id("agent"), "name": "Atlas Assistant", "role": "General assistant",
            "instructions": "Help the user with their request using the tools you are given. Be concise; "
                            "report what you changed and how you verified it.",
            "provider_id": pid, "model": model, "tools": list(AGENT_TOOL_GROUPS),
            "params": {"temperature": self.db.setting("agents.default_temperature")},
            "config": {"chat_assistant": True, "context_budget": self.db.setting("agents.default_context_budget"),
                       "max_parallel": 1},
            "created_at": t, "updated_at": t})
        self.bus.changed("agent", a["id"])
        return a

    def _context_prompt(self, cid: str, prompt: str, user_id: str) -> str:
        rows = [m for m in self.db.q("SELECT * FROM chat_messages WHERE conversation_id=? AND id!=? ORDER BY created_at, rowid",
                                     (cid, user_id)) if m["content"]][-8:]
        if not rows:
            return prompt
        hist = "\n".join(f"{m['role'].upper()}: {m['content'][:1500]}" for m in rows)
        return f"Conversation so far (for context):\n{hist}\n\nCurrent request:\n{prompt}"

    def _project_context(self, project_id: str) -> str:
        p = self.db.get("projects", project_id)
        if not p or not Path(p["path"]).is_dir():
            return ""
        root = Path(p["path"])
        names = sorted(x.name + ("/" if x.is_dir() else "") for x in root.iterdir()
                       if not x.name.startswith(".") and x.name not in ("node_modules", "__pycache__"))[:80]
        out = f"Project context — {p['name']} ({root}):\nTop-level entries: {', '.join(names)}"
        for readme in ("README.md", "README.txt", "README"):
            f = root / readme
            if f.is_file():
                out += f"\n\n{readme} (first 4000 chars):\n" + f.read_text(errors="replace")[:4000]
                break
        return out


def _title_from(text: str) -> str:
    line = " ".join((text or "").split())
    return (line[:60] + "…") if len(line) > 60 else (line or DEFAULT_TITLE)


def _with_attachments(content: str, attachments: List[Dict[str, Any]]) -> str:
    parts = [content] if content else []
    for a in attachments:
        if str(a.get("type", "")).startswith("image/"):
            parts.append(f"Image attached: `{a['name']}` ({a['type']}).")
        else:
            parts.append(f"Attached file `{a['name']}`:\n```\n{a['content']}\n```")
    return "\n\n".join(parts)


def _model_attachment_content(content: str, attachments: List[Dict[str, Any]]) -> Any:
    images = [a for a in attachments if str(a.get("type", "")).startswith("image/") and a.get("content")]
    texts = [a for a in attachments if not str(a.get("type", "")).startswith("image/")]
    if not images:
        return _with_attachments(content, texts)
    blocks: List[Dict[str, Any]] = []
    text = _with_attachments(content, texts)
    if text:
        blocks.append({"type": "text", "text": text})
    for image in images:
        blocks.append({"type": "image", "mime_type": image.get("type") or "image/png", "data": image["content"], "name": image.get("name", "image")})
    return blocks
