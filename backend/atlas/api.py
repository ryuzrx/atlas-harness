"""Typed local HTTP + WebSocket API. Bound to 127.0.0.1 and protected by a per-launch token."""
from __future__ import annotations

import asyncio
import hmac
import shutil
import os
import re
import subprocess
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

from fastapi import Body, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, gitops, monitor
from . import importers
from .chat import ChatError, ChatService
from . import extensions, skillhub, team_advisor
from .computer_use import ComputerUseBroker, ComputerUseError
from .config import DEFAULT_SETTINGS
from .db import DB, new_id, now
from .events import EventBus
from .mcp import MCPManager
from .orchestrator import InvalidTransition, Orchestrator
from .providers import KIND_LABELS, KINDS, ModelRouter, ProviderError
from .providers.catalog import OLLAMA_LIBRARY, PROVIDER_PRESETS
from .security import PermissionDenied, delete_secret, load_secret, resolve_in_workspace, store_secret
from .templates import TEMPLATES
from .tools import PERMISSION_GROUPS

def _local_user() -> str:
    """macOS short account name, for the profile chip. Nothing is sent anywhere."""
    import pwd
    try:
        return pwd.getpwuid(os.getuid()).pw_name
    except Exception:  # noqa: BLE001
        return os.environ.get("USER") or "you"


AGENT_FIELDS = {"name", "role", "instructions", "provider_id", "model", "params", "tools", "config", "team_id"}
TEAM_FIELDS = {"name", "description", "objective", "lead_agent_id", "project_id", "config"}


class State:
    db: DB
    bus: EventBus
    router: ModelRouter
    orch: Orchestrator
    mcp: MCPManager
    chat: ChatService
    pull_tasks: Dict[str, asyncio.Task]
    active_pulls: Dict[str, Dict[str, Any]]
    computer: ComputerUseBroker


S = State()


def create_app(token: str, db_path: Optional[Path] = None, static_dir: Optional[Path] = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        S.db = DB(db_path)
        S.bus = EventBus(S.db)
        S.router = ModelRouter(S.db)
        S.router.ensure_defaults()
        S.mcp = MCPManager()
        S.mcp.configure(S.db.setting("integrations.mcp_servers") or [])
        S.computer = ComputerUseBroker()
        S.orch = Orchestrator(S.db, S.bus, S.router, S.mcp, S.computer)
        S.orch.start()
        S.chat = ChatService(S.db, S.bus, S.router, S.orch)
        S.pull_tasks = {}
        S.active_pulls = {}
        S.chat.recover()
        health_task = asyncio.ensure_future(S.router.health_all())
        try:
            yield
        finally:
            health_task.cancel()
            await asyncio.gather(health_task, return_exceptions=True)
            for task in S.pull_tasks.values():
                task.cancel()
            await asyncio.gather(*S.pull_tasks.values(), return_exceptions=True)
            await S.chat.stop_all()
            await S.orch.stop()
            await S.mcp.shutdown()
            S.router.stop_ollama()

    app = FastAPI(title="ATLAS Harness", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None)

    @app.middleware("http")
    async def auth(request: Request, call_next):
        host = (request.headers.get("host") or "").split(":")[0]
        if host not in ("127.0.0.1", "localhost", "testserver"):
            return JSONResponse({"detail": "Forbidden host"}, status_code=403)
        if request.url.path.startswith("/api/"):
            supplied = request.headers.get("x-atlas-token") or request.query_params.get("token") or ""
            if not hmac.compare_digest(supplied, token):
                return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        return await call_next(request)

    def err(e: Exception, code: int = 400):
        raise HTTPException(code, str(e))

    def must(table: str, id_: str) -> Dict[str, Any]:
        row = S.db.get(table, id_)
        if not row:
            raise HTTPException(404, f"{table[:-1]} not found")
        return row

    # ------------------------------------------------------------ meta / settings
    @app.get("/api/health")
    async def health():
        return {"ok": True, "version": __version__, "schema": S.db.schema_version}

    @app.get("/api/extensions")
    async def get_extensions():
        s = S.db.settings()
        extensions.ensure_default_dirs()
        return {"skills": extensions.list_skills(s), "plugins": extensions.list_plugins(s),
                "hooks": extensions.load_hooks(s, force=True), "hooks_enabled": bool(s.get("extensions.hooks_enabled")),
                "dirs": {k: str(extensions.folder(s, k)) for k in extensions.KEYS},
                "defaults": {k: str(extensions.default_dir(k)) for k in extensions.KEYS}}

    @app.post("/api/extensions/skills")
    async def create_skill(body: Dict[str, Any] = Body(...)):
        try:
            r = extensions.create_skill(S.db.settings(), str(body.get("name", "")).strip(), str(body.get("description", "")), str(body.get("body", "")))
        except (ValueError, OSError) as e:
            err(e)
        S.db.audit("user", "skill_create", {"name": r["name"]})
        S.bus.changed("settings")
        return r

    @app.get("/api/skillhub/featured")
    async def hub_featured():
        return await skillhub.featured()

    @app.get("/api/skillhub/search")
    async def hub_search(q: str = ""):
        try:
            return await skillhub.search(q)
        except skillhub.HubError as e:
            err(e)

    @app.post("/api/skillhub/repo")
    async def hub_repo(body: Dict[str, Any] = Body(...)):
        try:
            return await skillhub.open_repo(str(body.get("owner", "")), str(body.get("repo", "")))
        except skillhub.HubError as e:
            err(e)

    @app.post("/api/skillhub/preview")
    async def hub_preview(body: Dict[str, Any] = Body(...)):
        try:
            return {"text": skillhub.preview(str(body.get("owner", "")), str(body.get("repo", "")), str(body.get("path", "")))}
        except skillhub.HubError as e:
            err(e)

    @app.post("/api/skillhub/install")
    async def hub_install(body: Dict[str, Any] = Body(...)):
        try:
            r = skillhub.install(S.db.settings(), str(body.get("owner", "")), str(body.get("repo", "")), [str(p) for p in body.get("paths") or []])
        except (skillhub.HubError, OSError) as e:
            err(e)
        S.db.audit("user", "skillhub_install", {"repo": f"{body.get('owner')}/{body.get('repo')}", "count": r["added"]})
        S.bus.changed("settings")
        return r

    @app.get("/api/skillpacks")
    async def skill_packs():
        return extensions.list_packs(S.db.settings())

    @app.post("/api/skillpacks/{pack_id}/install")
    async def install_skill_pack(pack_id: str, body: Dict[str, Any] = Body(default={})):
        try:
            r = extensions.install_pack(S.db.settings(), pack_id, body.get("skills"))
        except (ValueError, OSError) as e:
            err(e)
        S.db.audit("user", "skillpack_install", {"pack": pack_id, **r})
        S.bus.changed("settings")
        return r

    @app.post("/api/extensions/install")
    async def install_extension(body: Dict[str, Any] = Body(...)):
        kind = body.get("kind")
        if kind not in ("skills", "plugins"):
            raise HTTPException(400, "Unknown kind")
        try:
            r = extensions.install(S.db.settings(), kind, str(body.get("path", "")))
        except (ValueError, OSError) as e:
            err(e)
        S.db.audit("user", "extension_install", {"kind": kind, "name": r["name"]})
        S.bus.changed("settings")
        return r

    @app.delete("/api/extensions/{kind}/{name}")
    async def remove_extension(kind: str, name: str):
        if kind not in ("skills", "plugins"):
            raise HTTPException(400, "Unknown kind")
        try:
            extensions.remove(S.db.settings(), kind, name)
        except (ValueError, OSError) as e:
            err(e)
        S.db.audit("user", "extension_remove", {"kind": kind, "name": name})
        S.bus.changed("settings")
        return {"ok": True}

    @app.post("/api/extensions/hooks")
    async def add_hook(body: Dict[str, Any] = Body(...)):
        try:
            h = extensions.add_hook(S.db.settings(), str(body.get("label", "")), str(body.get("when", "")), str(body.get("command", "")), bool(body.get("block")))
        except (ValueError, OSError) as e:
            err(e)
        S.db.audit("user", "hook_add", {"id": h["id"], "command": h["command"]})
        S.bus.changed("settings")
        return h

    @app.patch("/api/extensions/hooks/{hook_id}")
    async def patch_hook(hook_id: str, body: Dict[str, Any] = Body(...)):
        try:
            extensions.update_hook(S.db.settings(), hook_id, bool(body["enabled"]))
        except (ValueError, KeyError, OSError) as e:
            err(e)
        S.bus.changed("settings")
        return {"ok": True}

    @app.delete("/api/extensions/hooks/{hook_id}")
    async def delete_hook(hook_id: str):
        try:
            extensions.update_hook(S.db.settings(), hook_id, None, delete=True)
        except (ValueError, OSError) as e:
            err(e)
        S.bus.changed("settings")
        return {"ok": True}

    @app.get("/api/settings")
    async def get_settings():
        return S.db.settings()

    @app.put("/api/settings")
    async def put_settings(body: Dict[str, Any] = Body(...)):
        for k, v in body.items():
            if k not in DEFAULT_SETTINGS:
                raise HTTPException(400, f"Unknown setting {k}")
            S.db.set_setting(k, v)
        if "integrations.mcp_servers" in body:
            S.mcp.configure(body["integrations.mcp_servers"] or [])
        if "execution.max_concurrent_inference" in body:
            S.router.reload()
        S.db.audit("user", "settings", {"keys": list(body)})
        S.bus.changed("settings")
        S.orch.poke()
        return S.db.settings()

    @app.get("/api/integrations/web-search")
    async def web_search_status():
        return {"provider": "Tavily", "connected": bool(load_secret("integration:tavily"))}

    @app.put("/api/integrations/web-search")
    async def connect_web_search(body: Dict[str, Any] = Body(...)):
        key = str(body.get("api_key") or "").strip()
        if not key or len(key) > 512:
            raise HTTPException(400, "Enter a valid Tavily API key.")
        try:
            store_secret("integration:tavily", key)
        except RuntimeError as e:
            raise HTTPException(501, str(e))
        S.db.audit("user", "web_search_connect", {"provider": "Tavily"})
        return {"provider": "Tavily", "connected": True}

    @app.delete("/api/integrations/web-search")
    async def disconnect_web_search():
        delete_secret("integration:tavily")
        S.db.audit("user", "web_search_disconnect", {"provider": "Tavily"})
        return {"provider": "Tavily", "connected": False}

    @app.post("/api/settings/reset")
    async def reset_settings():
        S.db.x("DELETE FROM settings")
        S.mcp.configure([])
        S.router.reload()
        S.db.audit("user", "settings_reset", {})
        S.bus.changed("settings")
        return S.db.settings()

    @app.get("/api/meta")
    async def meta():
        return {"version": __version__, "provider_kinds": KIND_LABELS, "permission_groups": PERMISSION_GROUPS,
                "user": (S.db.setting("profile.name") or "").strip() or _local_user(),
                "provider_presets": PROVIDER_PRESETS, "ollama_library": OLLAMA_LIBRARY,
                "templates": {k: {"name": v["name"], "description": v["description"], "agents": len(v["agents"])}
                              for k, v in TEMPLATES.items()}}

    # ------------------------------------------------------------ providers & models
    def provider_view(row):
        p = S.router.providers.get(row["id"])
        cfg = dict(row.get("config") or {})
        return {**row, "config": cfg, "kind_label": KIND_LABELS.get(row["kind"], row["kind"]),
                "stats": p.stats() if p else None, "agentic": bool(p and p.agentic)}

    @app.get("/api/providers")
    async def providers():
        return [provider_view(r) for r in S.db.q("SELECT * FROM providers ORDER BY created_at")]

    @app.post("/api/providers")
    async def add_provider(body: Dict[str, Any] = Body(...)):
        if body.get("kind") not in KINDS:
            raise HTTPException(400, "Unknown provider kind")
        t = now()
        cfg = dict(body.get("config") or {})
        pid = new_id("prov")
        if body.get("api_key"):
            store_secret(f"provider:{pid}", body["api_key"])
            cfg["has_secret"] = True
        row = S.db.insert("providers", {"id": pid, "kind": body["kind"], "name": body.get("name") or KIND_LABELS[body["kind"]],
                                        "base_url": body.get("base_url"), "config": cfg, "enabled": 1,
                                        "created_at": t, "updated_at": t})
        S.router.reload()
        S.db.audit("user", "provider_add", {"id": pid, "kind": body["kind"]})
        S.bus.changed("provider", pid)
        return provider_view(row)

    @app.post("/api/providers/test-config")
    async def test_provider_config(body: Dict[str, Any] = Body(...)):
        """Check an endpoint *before* saving it: reachability, key validity, and how many models it offers.
        Nothing is stored; the key only lives in memory for this request."""
        cls = KINDS.get(body.get("kind"))
        if not cls:
            raise HTTPException(400, "Unknown provider kind")
        row = {"id": "test", "kind": body["kind"], "name": body.get("name") or KIND_LABELS.get(body["kind"], "Endpoint"),
               "base_url": body.get("base_url"), "config": dict(body.get("config") or {})}
        p = cls(row, body.get("api_key") or None)
        try:
            h = await asyncio.wait_for(p.health(), 25)
        except asyncio.TimeoutError:
            return {"ok": False, "error": "Timed out after 25 s. Check the URL and your network."}
        if not h.get("ok"):
            return {"ok": False, "error": h.get("error") or "Not reachable."}
        try:
            models = await asyncio.wait_for(p.list_models(), 25)
            names = [m.name for m in models if m.name]
        except Exception as e:  # noqa: BLE001 - reachable but cannot list: still connectable
            return {"ok": True, "count": None, "models": [], "note": f"Connected, but the model list failed: {e}"[:300]}
        note = h.get("note")
        if body.get("api_key") and row["config"].get("public_model_list"):
            note = "This provider lists models without checking keys, so your key is verified when you send the first message."
        return {"ok": True, "count": len(names), "models": names[:12], "version": h.get("version"), "note": note}

    @app.patch("/api/providers/{pid}")
    async def patch_provider(pid: str, body: Dict[str, Any] = Body(...)):
        row = must("providers", pid)
        upd: Dict[str, Any] = {k: body[k] for k in ("name", "base_url", "enabled") if k in body}
        if "config" in body:
            cfg = dict(row["config"] or {})
            cfg.update(body["config"])
            upd["config"] = cfg
        if body.get("api_key"):
            store_secret(f"provider:{pid}", body["api_key"])
            upd.setdefault("config", dict(row["config"] or {}))["has_secret"] = True
        upd["updated_at"] = now()
        S.db.update("providers", pid, upd)
        S.router.reload()
        S.bus.changed("provider", pid)
        return provider_view(S.db.get("providers", pid))

    @app.delete("/api/providers/{pid}")
    async def del_provider(pid: str):
        must("providers", pid)
        delete_secret(f"provider:{pid}")
        S.db.delete("providers", pid)
        S.db.x("UPDATE agents SET provider_id=NULL WHERE provider_id=?", (pid,))
        S.router.reload()
        S.bus.changed("provider", pid)
        return {"ok": True}

    @app.post("/api/providers/{pid}/test")
    async def test_provider(pid: str):
        try:
            p = S.router.get(pid)
        except ProviderError as e:
            err(e)
        h = await p.health()
        S.router._set_status(pid, "connected" if h.get("ok") else "unavailable", None if h.get("ok") else h.get("error"))
        S.bus.changed("provider", pid)
        return h

    @app.post("/api/providers/{pid}/probe")
    async def probe(pid: str, body: Dict[str, Any] = Body(...)):
        try:
            return await S.router.probe(pid, body["model"])
        except ProviderError as e:
            err(e)

    @app.post("/api/providers/{pid}/chat")
    async def test_chat(pid: str, body: Dict[str, Any] = Body(...)):
        """Single real inference request (used by the Models screen and acceptance test 1)."""
        try:
            r = await S.router.chat(pid, body["model"], [{"role": "user", "content": body.get("prompt", "Say hello in five words.")}],
                                    params={"temperature": 0.2, "max_tokens": 200}, retries=0)
            return {"text": r.text, "usage": r.usage, "latency_ms": round(r.latency_ms)}
        except ProviderError as e:
            err(e, 502)

    @app.post("/api/prompts/enhance")
    async def enhance_prompt(body: Dict[str, Any] = Body(...)):
        """Rewrite a draft prompt using the selected model without adding it to chat history."""
        prompt = str(body.get("prompt") or "").strip()
        provider_id = str(body.get("provider_id") or "")
        model = str(body.get("model") or "")
        if not prompt:
            raise HTTPException(400, "Write a prompt first.")
        if len(prompt) > 30_000:
            raise HTTPException(400, "Prompt is too long to enhance. Try a shorter draft.")
        if not provider_id or not model:
            raise HTTPException(400, "Choose a model before enhancing the prompt.")
        system = (
            "Rewrite the user's draft as a clear, useful prompt they can paste into an AI chat. "
            "Preserve the user's intent, facts, names, scope, constraints, and tone. Do not answer the request. "
            "Do not invent requirements, facts, tools, or success criteria. Clarify the desired outcome and "
            "organize context, constraints, deliverables, and verification only where the draft supports them. "
            "Keep it appropriately thorough without adding filler. If the draft is already clear, make only "
            "small improvements. Return only the revised prompt, with no preamble or explanation."
        )
        try:
            result = await asyncio.wait_for(S.router.chat(
                provider_id, model,
                [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                retries=0, params={"temperature": 0.25, "max_tokens": 1400},
            ), timeout=65)
        except asyncio.TimeoutError:
            raise HTTPException(504, "Prompt enhancement timed out. Try again.")
        except ProviderError as e:
            err(e, 502)
        revised = (result.text or "").strip()
        if revised.startswith("```") and revised.endswith("```"):
            revised = re.sub(r"^```[A-Za-z0-9_-]*\s*|\s*```$", "", revised).strip()
        if not revised:
            raise HTTPException(502, "The selected model returned an empty rewrite. Try again.")
        return {"prompt": revised, "provider_id": provider_id, "model": model}

    @app.get("/api/models")
    async def models():
        rows = await S.router.models()
        assigned: Dict[str, List[str]] = {}
        for a in S.db.q("SELECT id, name, provider_id, model FROM agents WHERE model IS NOT NULL"):
            assigned.setdefault(f"{a['provider_id']}::{a['model']}", []).append(a["name"])
        for r in rows:
            r["assigned_agents"] = assigned.get(f"{r['provider_id']}::{r.get('name')}", [])
        return rows

    @app.post("/api/models/pull")
    async def pull(body: Dict[str, Any] = Body(...)):
        p = S.router.get(body["provider_id"])
        if p.kind != "ollama":
            raise HTTPException(400, "Pulling is supported for Ollama providers.")
        health = await p.health()
        if not health.get("ok"):
            endpoint = urlsplit(p.base_url)
            local_managed_ollama = endpoint.hostname in ("localhost", "127.0.0.1", "::1") and endpoint.port in (None, 11434)
            if not local_managed_ollama:
                raise HTTPException(503, health.get("error") or "The configured Ollama endpoint is not reachable.")
            started = await S.router.start_ollama()
            if not started.get("ok"):
                raise HTTPException(503, started.get("error") or "Ollama could not be started.")

        pull_id = new_id("pull")
        state = {"pull_id": pull_id, "provider_id": p.id, "model": body["model"], "status": "starting",
                 "completed": 0, "total": 0}
        S.active_pulls[pull_id] = state
        S.bus.broadcast({"kind": "pull", **state})

        async def run():
            last = 0.0
            try:
                async for ev in p.pull(body["model"]):  # type: ignore[attr-defined]
                    state.update(ev)
                    state.update({"kind": "pull", "pull_id": pull_id, "provider_id": p.id, "model": body["model"]})
                    if time.monotonic() - last > 0.3 or ev.get("status") == "success":
                        last = time.monotonic()
                        S.bus.broadcast(dict(state))
                state["status"] = "success"
                S.bus.broadcast(dict(state))
                S.bus.emit("model_pulled", {"model": body["model"], "provider_id": p.id})
            except asyncio.CancelledError:
                state["status"] = "cancelled"
                S.bus.broadcast(dict(state))
                raise
            except Exception as e:  # noqa: BLE001
                S.bus.emit("error", {"message": f"Pull failed for {body['model']}: {e}"})
                state.update({"status": "error", "error": str(e)})
                S.bus.broadcast(dict(state))
            finally:
                S.active_pulls.pop(pull_id, None)
                S.pull_tasks.pop(pull_id, None)
                S.bus.changed("pull")
                S.bus.changed("model")
        S.pull_tasks[pull_id] = asyncio.create_task(run())
        S.bus.changed("pull")
        return {"started": True, "pull_id": pull_id}

    @app.get("/api/models/pulls")
    async def active_model_pulls():
        return list(S.active_pulls.values())

    @app.post("/api/models/pulls/{pull_id}/cancel")
    async def cancel_model_pull(pull_id: str):
        task = S.pull_tasks.get(pull_id)
        if not task or task.done():
            raise HTTPException(404, "That model download is no longer active.")
        task.cancel()
        return {"ok": True}

    @app.post("/api/models/delete")
    async def delete_model(body: Dict[str, Any] = Body(...)):
        p = S.router.get(body["provider_id"])
        if p.kind != "ollama":
            raise HTTPException(400, "Only Ollama models can be deleted from ATLAS.")
        await p.delete_model(body["model"])  # type: ignore[attr-defined]
        S.db.audit("user", "model_delete", body)
        S.bus.changed("model")
        return {"ok": True}

    @app.post("/api/models/unload")
    async def unload_model(body: Dict[str, Any] = Body(...)):
        p = S.router.get(body["provider_id"])
        if p.kind != "ollama":
            raise HTTPException(400, "Unload is supported for Ollama.")
        await p.unload(body["model"])  # type: ignore[attr-defined]
        S.bus.changed("model")
        return {"ok": True}

    @app.get("/api/ollama")
    async def ollama_status():
        prov = next((p for p in S.router.providers.values() if p.kind == "ollama"), None)
        h = await prov.health() if prov else {"ok": False, "error": "No Ollama provider configured"}
        model_dir = str(S.db.setting("models.ollama_dir") or "").strip()
        return {"binary": S.router.ollama_binary(), "running": h.get("ok"), "health": h,
                "managed": bool(S.router.ollama_proc and S.router.ollama_proc.poll() is None),
                "model_dir": model_dir, "default_model_dir": str(Path.home() / ".ollama" / "models")}

    @app.post("/api/ollama/install")
    async def ollama_install():
        async def progress(p):
            S.bus.broadcast({"kind": "install", "target": "ollama", **p})
        try:
            path = await S.router.install_ollama(progress)
        except Exception as e:  # noqa: BLE001
            err(e, 500)
        S.db.audit("user", "install_ollama", {"path": path})
        return {"ok": True, "path": path}

    @app.post("/api/ollama/start")
    async def ollama_start():
        r = await S.router.start_ollama()
        S.bus.changed("provider")
        return r

    @app.post("/api/ollama/stop")
    async def ollama_stop():
        r = S.router.stop_ollama()
        S.bus.changed("provider")
        return r

    # ------------------------------------------------------------ teams
    def team_view(t):
        agents = S.db.q("SELECT id, name, role, status, model FROM agents WHERE team_id=?", (t["id"],))
        active = S.db.one("SELECT COUNT(*) n FROM tasks WHERE team_id=? AND status IN ('planning','running','reviewing','waiting_approval','ready','queued')", (t["id"],))["n"]
        last = S.db.one("SELECT MAX(at) at FROM events WHERE team_id=?", (t["id"],))["at"]
        cur = S.db.one("SELECT id, title, status FROM tasks WHERE team_id=? AND kind='objective' ORDER BY created_at DESC LIMIT 1", (t["id"],))
        running_agents = sum(1 for a in agents if a["status"] in ("running", "waiting"))
        status = "archived" if t["archived"] else ("active" if running_agents or active else "idle")
        return {**t, "agents": agents, "agent_count": len(agents), "active_tasks": active, "last_activity": last,
                "current": cur, "status": status, "running_agents": running_agents}

    @app.get("/api/teams")
    async def teams(archived: bool = False):
        rows = S.db.q("SELECT * FROM teams WHERE archived=? ORDER BY updated_at DESC", (1 if archived else 0,))
        return [team_view(t) for t in rows]

    def routing_for(tier: str):
        return (S.db.setting("models.routing") or {}).get(tier) or {}

    def available_agent_models(models: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [m for m in models if m.get("name") and m.get("provider_kind") not in ("claude_code", "codex_cli")
                and not (m.get("capabilities") or {}).get("agentic")]

    def choose_agent_model(tier: str, available: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not available:
            return None
        preferred = routing_for(tier)
        pinned = next((m for m in available if m.get("provider_id") == preferred.get("provider_id") and
                       m.get("name") == preferred.get("model")), None)
        if pinned:
            return pinned
        if tier == "reasoning":
            return max(available, key=lambda m: (m.get("context_length") or 0, (m.get("capabilities") or {}).get("tools") is True,
                                                  m.get("provider_name", ""), m["name"]))
        if tier == "coding":
            return max(available, key=lambda m: ((m.get("capabilities") or {}).get("tools") is True,
                                                  m.get("context_length") or 0, m.get("provider_name", ""), m["name"]))
        return min(available, key=lambda m: (m.get("size_bytes") or float("inf"), m.get("provider_name", ""), m["name"]))

    def agent_tier(agent: Dict[str, Any]) -> str:
        tier = (agent.get("config") or {}).get("tier")
        if tier in ("reasoning", "coding", "light"):
            return tier
        role = str(agent.get("role") or "").lower()
        if any(word in role for word in ("lead", "review", "architect", "security", "evaluator", "performance")):
            return "reasoning"
        if any(word in role for word in ("research", "analyst", "doc", "ux")):
            return "light"
        return "coding"

    @app.post("/api/teams/suggest")
    async def suggest_teams(body: Dict[str, Any] = Body(...)):
        need = str(body.get("need") or "").strip()[:1500]
        if not need:
            raise HTTPException(400, "Describe what you want to do.")
        ids, reason, source, model_name = team_advisor.heuristic(need), "", "keywords", None
        try:
            choice = routing_for("light") or routing_for("reasoning")
            if not (choice.get("provider_id") and choice.get("model")):
                for m in await S.router.models():
                    p = S.router.providers.get(m.get("provider_id"))
                    if m.get("name") and p and not p.agentic and p.row.get("enabled"):
                        choice = {"provider_id": m["provider_id"], "model": m["name"]}
                        break
            if choice.get("provider_id") and choice.get("model"):
                res = await asyncio.wait_for(S.router.chat(choice["provider_id"], choice["model"], team_advisor.build_messages(need, TEMPLATES), retries=0), 45)
                parsed = team_advisor.parse_reply(res.text, list(TEMPLATES))
                if parsed:
                    ids, reason, source, model_name = parsed[0], parsed[1], "ai", choice["model"]
        except Exception:  # noqa: BLE001 - discovery and inference failures use keyword matching
            pass
        return {"teams": ids, "reason": reason, "source": source, "model": model_name}

    @app.post("/api/teams")
    async def create_team(body: Dict[str, Any] = Body(...)):
        if body.get("project_id"):
            must("projects", body["project_id"])
        t = now()
        tpl = TEMPLATES.get(body.get("template") or "")
        tid = new_id("team")
        S.db.insert("teams", {"id": tid, "name": body.get("name") or (tpl["name"] if tpl else "New Team"),
                              "description": body.get("description") or (tpl["description"] if tpl else ""),
                              "project_id": body.get("project_id"), "config": body.get("config") or {},
                              "created_at": t, "updated_at": t})
        available: Optional[List[Dict[str, Any]]] = None
        lead_id = None
        specs = body.get("auto_specs") if body.get("auto_team") else (tpl["agents"] if tpl else [])
        specs = specs or []
        if body.get("auto_team") and tpl:
            # Auto teams keep the lead and at most two specialists to bound model usage.
            lead = next((spec for spec in specs if spec.get("lead")), None)
            specs = ([lead] if lead else []) + [spec for spec in specs if not spec.get("lead")][:2]
        for spec in specs:
            route = (body.get("routing") or {}).get(spec["tier"]) or ({} if body.get("auto_assign_models") else routing_for(spec["tier"]))
            if not (route.get("provider_id") and route.get("model")):
                if available is None:
                    available = available_agent_models(await S.router.models())
                selected = choose_agent_model(spec["tier"], available)
                if selected:
                    route = {"provider_id": selected["provider_id"], "model": selected["name"]}
            aid = new_id("agent")
            S.db.insert("agents", {"id": aid, "team_id": tid, "name": spec["name"], "role": spec["role"],
                                   "instructions": spec["instructions"], "provider_id": route.get("provider_id"),
                                   "model": route.get("model"), "tools": spec["tools"],
                                   "params": {"temperature": S.db.setting("agents.default_temperature")},
                                   "config": {"tier": spec["tier"], "context_budget": min(int(S.db.setting("agents.default_context_budget") or 16000), 8192)
                                              if body.get("auto_team") else S.db.setting("agents.default_context_budget"),
                                              "max_parallel": 1, **({"max_steps": 6} if body.get("auto_team") else {})},
                                   "created_at": t, "updated_at": t})
            if spec.get("lead"):
                lead_id = aid
        if lead_id:
            S.db.update("teams", tid, {"lead_agent_id": lead_id})
        S.db.audit("user", "team_create", {"id": tid, "template": body.get("template")})
        S.bus.changed("team", tid)
        return team_view(S.db.get("teams", tid))

    @app.post("/api/teams/auto")
    async def create_auto_team(body: Dict[str, Any] = Body(...)):
        need = str(body.get("need") or "").strip()[:1500]
        if not need:
            raise HTTPException(400, "Describe what you want the team to do.")
        # Keyword routing is local and free; team planning remains the only extra model call.
        template_ids = team_advisor.heuristic(need)[:2]
        template = template_ids[0]
        lead = next((spec for spec in TEMPLATES[template]["agents"] if spec.get("lead")), None)
        specialists = []
        for template_id in template_ids:
            specialist = next((spec for spec in TEMPLATES[template_id]["agents"] if not spec.get("lead")), None)
            if specialist and specialist["role"] not in {item["role"] for item in specialists}:
                specialists.append(specialist)
        if len(template_ids) == 1:
            specialists.extend(spec for spec in TEMPLATES[template]["agents"]
                               if not spec.get("lead") and spec["role"] not in {item["role"] for item in specialists})
        specs = ([lead] if lead else []) + specialists[:2]
        return await create_team({"template": template, "name": f"Auto · {TEMPLATES[template]['name']}",
                                  "project_id": body.get("project_id"), "auto_assign_models": True,
                                  "routing": body.get("routing") or {},
                                  "auto_specs": specs,
                                  "auto_team": True})

    @app.get("/api/teams/{tid}")
    async def get_team(tid: str):
        return team_view(must("teams", tid))

    @app.post("/api/teams/{tid}/agents/auto-assign")
    async def auto_assign_team_models(tid: str):
        must("teams", tid)
        available = available_agent_models(await S.router.models())
        if not available:
            return {"assigned": [], "message": "No reachable model endpoints are available. Connect an endpoint and try again."}

        changed = []
        t = now()
        for agent in S.db.q("SELECT * FROM agents WHERE team_id=? ORDER BY created_at", (tid,)):
            if agent.get("provider_id") and agent.get("model"):
                continue
            model = choose_agent_model(agent_tier(agent), available)
            if not model:
                continue
            S.db.update("agents", agent["id"], {"provider_id": model["provider_id"], "model": model["name"], "updated_at": t})
            changed.append({"id": agent["id"], "name": agent["name"], "model": model["name"], "provider_id": model["provider_id"]})
            S.bus.changed("agent", agent["id"])
        if changed:
            S.db.audit("user", "team_auto_assign_models", {"team_id": tid, "agents": [a["id"] for a in changed]})
            S.orch.poke()
        return {"assigned": changed, "message": "Models assigned to unconfigured agents." if changed else "All team agents already have models assigned."}

    @app.patch("/api/teams/{tid}")
    async def patch_team(tid: str, body: Dict[str, Any] = Body(...)):
        must("teams", tid)
        upd = {k: v for k, v in body.items() if k in TEAM_FIELDS}
        upd["updated_at"] = now()
        S.db.update("teams", tid, upd)
        S.bus.changed("team", tid)
        return team_view(S.db.get("teams", tid))

    @app.post("/api/teams/{tid}/duplicate")
    async def dup_team(tid: str):
        src = must("teams", tid)
        t = now()
        nid = new_id("team")
        S.db.insert("teams", {**{k: src[k] for k in ("description", "objective", "project_id", "config")},
                              "id": nid, "name": src["name"] + " copy", "created_at": t, "updated_at": t})
        for a in S.db.q("SELECT * FROM agents WHERE team_id=?", (tid,)):
            aid = new_id("agent")
            S.db.insert("agents", {**{k: a[k] for k in AGENT_FIELDS}, "id": aid, "team_id": nid, "created_at": t, "updated_at": t})
            if a["id"] == src.get("lead_agent_id"):
                S.db.update("teams", nid, {"lead_agent_id": aid})
        S.bus.changed("team", nid)
        return team_view(S.db.get("teams", nid))

    @app.post("/api/teams/{tid}/archive")
    async def archive_team(tid: str, body: Dict[str, Any] = Body(default={})):
        must("teams", tid)
        S.db.update("teams", tid, {"archived": 1 if body.get("archived", True) else 0, "updated_at": now()})
        S.bus.changed("team", tid)
        return {"ok": True}

    @app.delete("/api/teams/{tid}")
    async def delete_team(tid: str):
        must("teams", tid)
        live = S.db.one("SELECT COUNT(*) n FROM tasks WHERE team_id=? AND status IN ('planning','running','reviewing','waiting_approval')", (tid,))["n"]
        if live:
            raise HTTPException(409, "Team has active tasks; cancel them first.")
        S.db.x("DELETE FROM agents WHERE team_id=?", (tid,))
        S.db.delete("teams", tid)
        S.db.audit("user", "team_delete", {"id": tid})
        S.bus.changed("team", tid)
        return {"ok": True}

    # ------------------------------------------------------------ agents
    def agent_view(a):
        cur = S.db.one("SELECT id, title, status FROM tasks WHERE agent_id=? AND status IN ('running','waiting_approval','planning','reviewing') ORDER BY updated_at DESC LIMIT 1", (a["id"],))
        team = S.db.get("teams", a["team_id"]) if a.get("team_id") else None
        prov = S.db.get("providers", a["provider_id"]) if a.get("provider_id") else None
        last = S.db.one("SELECT MAX(at) at FROM events WHERE agent_id=?", (a["id"],))["at"]
        return {**a, "current_task": cur, "team_name": team["name"] if team else None,
                "provider_name": prov["name"] if prov else None, "provider_kind": prov["kind"] if prov else None,
                "last_activity": last, "is_lead": bool(team and team.get("lead_agent_id") == a["id"])}

    @app.get("/api/agents")
    async def agents(team_id: Optional[str] = None):
        rows = S.db.q("SELECT * FROM agents WHERE team_id=? ORDER BY created_at", (team_id,)) if team_id else \
            S.db.q("SELECT * FROM agents ORDER BY team_id, created_at")
        return [agent_view(a) for a in rows]

    @app.get("/api/agents/{aid}")
    async def get_agent(aid: str):
        return agent_view(must("agents", aid))

    @app.post("/api/agents")
    async def create_agent(body: Dict[str, Any] = Body(...)):
        name = str(body.get("name") or "").strip()
        role = str(body.get("role") or "").strip()
        if not name or not role:
            raise HTTPException(400, "name and role are required")
        if body.get("team_id"):
            must("teams", body["team_id"])
        t = now()
        data = {k: v for k, v in body.items() if k in AGENT_FIELDS}
        data.update(name=name, role=role)
        data.setdefault("tools", ["read", "messages", "memory"])
        data.setdefault("params", {"temperature": S.db.setting("agents.default_temperature")})
        data.setdefault("config", {"context_budget": S.db.setting("agents.default_context_budget"), "max_parallel": 1})
        if body.get("auto_assign_model") and not (data.get("provider_id") and data.get("model")):
            available = available_agent_models(await S.router.models())
            selected = choose_agent_model(agent_tier(data), available)
            if selected:
                data.update(provider_id=selected["provider_id"], model=selected["name"])
        a = S.db.insert("agents", {**data, "id": new_id("agent"), "created_at": t, "updated_at": t})
        S.bus.changed("agent", a["id"])
        return agent_view(a)

    @app.patch("/api/agents/{aid}")
    async def patch_agent(aid: str, body: Dict[str, Any] = Body(...)):
        must("agents", aid)
        upd = {k: v for k, v in body.items() if k in AGENT_FIELDS}
        if "tools" in upd and any(t not in PERMISSION_GROUPS for t in upd["tools"]):
            raise HTTPException(400, "Unknown permission group")
        upd["updated_at"] = now()
        S.db.update("agents", aid, upd)
        if body.get("make_lead"):
            a = S.db.get("agents", aid)
            S.db.update("teams", a["team_id"], {"lead_agent_id": aid})
        S.db.audit("user", "agent_update", {"id": aid, "fields": list(upd)})
        S.bus.changed("agent", aid)
        S.orch.poke()
        return agent_view(S.db.get("agents", aid))

    @app.post("/api/agents/{aid}/clone")
    async def clone_agent(aid: str, body: Dict[str, Any] = Body(default={})):
        a = must("agents", aid)
        t = now()
        c = S.db.insert("agents", {**{k: a[k] for k in AGENT_FIELDS}, "id": new_id("agent"), "name": a["name"] + " copy",
                                   "team_id": body.get("team_id", a["team_id"]), "created_at": t, "updated_at": t})
        S.bus.changed("agent", c["id"])
        return agent_view(c)

    @app.post("/api/agents/{aid}/move")
    async def move_agent(aid: str, body: Dict[str, Any] = Body(...)):
        a = must("agents", aid)
        if body.get("team_id"):
            must("teams", body["team_id"])
        if S.db.one("SELECT 1 FROM teams WHERE lead_agent_id=?", (aid,)):
            S.db.x("UPDATE teams SET lead_agent_id=NULL WHERE lead_agent_id=?", (aid,))
        S.db.update("agents", aid, {"team_id": body.get("team_id"), "updated_at": now()})
        S.bus.changed("agent", aid)
        return agent_view(S.db.get("agents", a["id"]))

    @app.post("/api/agents/{aid}/pause")
    async def pause_agent(aid: str):
        must("agents", aid)
        S.db.update("agents", aid, {"status": "paused", "updated_at": now()})
        S.bus.emit("agent_paused", {}, agent_id=aid)
        S.bus.changed("agent", aid)
        return {"ok": True, "note": "Paused agents finish their current step; no new tasks start until resumed."}

    @app.post("/api/agents/{aid}/resume")
    async def resume_agent(aid: str):
        must("agents", aid)
        busy = S.db.one("SELECT 1 FROM tasks WHERE agent_id=? AND status IN ('running','waiting_approval')", (aid,))
        S.db.update("agents", aid, {"status": "running" if busy else "idle", "updated_at": now()})
        S.bus.emit("agent_resumed", {}, agent_id=aid)
        S.bus.changed("agent", aid)
        S.orch.poke()
        return {"ok": True}

    @app.post("/api/agents/{aid}/cancel")
    async def cancel_agent(aid: str):
        for t in S.db.q("SELECT id FROM tasks WHERE agent_id=? AND status IN ('running','waiting_approval','planning','reviewing')", (aid,)):
            S.orch.cancel(t["id"], "Cancelled from agent controls")
        return {"ok": True}

    @app.delete("/api/agents/{aid}")
    async def delete_agent(aid: str):
        must("agents", aid)
        if S.db.one("SELECT 1 FROM tasks WHERE agent_id=? AND status IN ('running','waiting_approval','planning')", (aid,)):
            raise HTTPException(409, "Agent is running a task.")
        S.db.x("UPDATE teams SET lead_agent_id=NULL WHERE lead_agent_id=?", (aid,))
        S.db.delete("agents", aid)
        S.bus.changed("agent", aid)
        return {"ok": True}

    @app.get("/api/presets")
    async def presets():
        return S.db.q("SELECT * FROM presets ORDER BY created_at DESC")

    @app.post("/api/presets")
    async def save_preset(body: Dict[str, Any] = Body(...)):
        a = must("agents", body["agent_id"])
        p = S.db.insert("presets", {"id": new_id("preset"), "name": body.get("name") or a["name"],
                                    "data": {k: a[k] for k in AGENT_FIELDS if k != "team_id"}, "created_at": now()})
        S.bus.changed("preset")
        return p

    @app.delete("/api/presets/{pid}")
    async def delete_preset(pid: str):
        S.db.delete("presets", pid)
        S.bus.changed("preset")
        return {"ok": True}

    # ------------------------------------------------------------ projects
    @app.get("/api/projects")
    async def projects():
        out = []
        for p in S.db.q("SELECT * FROM projects ORDER BY workspace, sort, name"):
            exists = Path(p["path"]).is_dir()
            out.append({**p, "exists": exists, "is_repo": exists and gitops.is_repo(Path(p["path"]))})
        return out

    @app.post("/api/projects")
    async def add_project(body: Dict[str, Any] = Body(...)):
        path = Path(body["path"]).expanduser().resolve()
        if not path.is_dir():
            raise HTTPException(400, "Folder does not exist.")
        if path == Path.home() or str(path) == "/":
            raise HTTPException(400, "Choose a project folder, not your home folder or the disk root.")
        if S.db.one("SELECT 1 FROM projects WHERE path=?", (str(path),)):
            raise HTTPException(409, "Project already added.")
        p = S.db.insert("projects", {"id": new_id("proj"), "name": body.get("name") or path.name, "path": str(path),
                                     "workspace": body.get("workspace") or "Default", "created_at": now()})
        S.db.audit("user", "project_add", {"path": str(path)})
        S.bus.changed("project", p["id"])
        return p

    @app.post("/api/projects/clone")
    async def clone_project(body: Dict[str, Any] = Body(...)):
        """Clone a Git remote into a user-chosen local parent directory."""
        remote = str(body.get("url") or "").strip()
        parent = Path(str(body.get("parent") or "")).expanduser().resolve()
        parsed = urlsplit(remote)
        ssh_scp = remote.startswith("git@") and ":" in remote and " " not in remote
        valid_https = parsed.scheme == "https" and bool(parsed.hostname) and not parsed.username and not parsed.password
        valid_ssh = parsed.scheme == "ssh" and bool(parsed.hostname) and parsed.username == "git" and not parsed.password
        if not (valid_https or valid_ssh or ssh_scp) or "\x00" in remote:
            raise HTTPException(400, "Enter an HTTPS or SSH Git repository URL.")
        if not parent.is_dir() or parent == Path("/"):
            raise HTTPException(400, "Choose an existing parent folder on this Mac.")
        leaf = remote.rstrip("/").rsplit("/", 1)[-1].rsplit(":", 1)[-1]
        name = leaf[:-4] if leaf.lower().endswith(".git") else leaf
        if not name or name in (".", "..") or any(ch in name for ch in ("/", "\\", "\x00")):
            raise HTTPException(400, "That repository URL does not contain a valid project name.")
        destination = parent / name
        if destination.exists():
            raise HTTPException(409, f"A folder named {name} already exists in that location.")
        env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
        try:
            result = await asyncio.to_thread(
                subprocess.run,
                ["git", "clone", "--", remote, str(destination)],
                capture_output=True, text=True, timeout=600, env=env,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(504, "Git clone timed out. Check the remote and try again.")
        if result.returncode:
            detail = (result.stderr or "Git could not clone that repository.").strip().splitlines()[-1][:500]
            raise HTTPException(400, detail)
        p = S.db.insert("projects", {"id": new_id("proj"), "name": name, "path": str(destination),
                                     "workspace": "Default", "config": {"source": "git"}, "created_at": now()})
        S.db.audit("user", "project_clone", {"project": p["id"]})
        S.bus.changed("project", p["id"])
        return p

    @app.get("/api/import/scan")
    async def import_scan():
        """Project folders used by other AI tools on this Mac (paths only, read locally)."""
        existing = [r["path"] for r in S.db.q("SELECT path FROM projects")]
        result = await asyncio.to_thread(importers.scan, existing)
        installed = {s["folder"] for s in extensions.list_skills(S.db.settings())}
        found = await asyncio.to_thread(importers.skills)
        for s in found:
            s["added"] = extensions.install_name(Path(str(s["path"]))) in installed
        result["skills"] = found
        return result

    @app.post("/api/import/skills")
    async def import_skills(body: Dict[str, Any] = Body(...)):
        roots = importers.skill_roots()
        added, skipped = [], []
        for raw in (body.get("paths") or [])[:300]:
            path = Path(str(raw)).expanduser().resolve()
            if not any(r in path.parents for r in roots):
                skipped.append({"path": str(path), "reason": "not a known skills folder"}); continue
            try:
                added.append(extensions.install(S.db.settings(), "skills", str(path)))
            except (ValueError, OSError) as e:
                skipped.append({"path": str(path), "reason": str(e)})
        if added:
            S.db.audit("user", "skill_import", {"count": len(added)})
            S.bus.changed("settings")
        return {"added": added, "skipped": skipped}

    @app.post("/api/import/projects")
    async def import_projects(body: Dict[str, Any] = Body(...)):
        added, skipped = [], []
        for raw in (body.get("paths") or [])[:300]:
            path = Path(str(raw)).expanduser().resolve()
            if not path.is_dir() or path in (Path.home(), importers._home()) or str(path) == "/":
                skipped.append({"path": str(path), "reason": "not a folder"}); continue
            if S.db.one("SELECT 1 FROM projects WHERE path=?", (str(path),)):
                skipped.append({"path": str(path), "reason": "already added"}); continue
            p = S.db.insert("projects", {"id": new_id("proj"), "name": path.name, "path": str(path),
                                         "workspace": body.get("workspace") or "Default", "created_at": now()})
            S.db.audit("user", "project_import", {"path": str(path)})
            added.append(p)
        if added:
            S.bus.changed("project", None)
        return {"added": added, "skipped": skipped}

    @app.patch("/api/projects/{pid}")
    async def patch_project(pid: str, body: Dict[str, Any] = Body(...)):
        must("projects", pid)
        S.db.update("projects", pid, {k: v for k, v in body.items() if k in ("name", "workspace", "sort", "config")})
        S.bus.changed("project", pid)
        return S.db.get("projects", pid)

    @app.delete("/api/projects/{pid}")
    async def delete_project(pid: str):
        must("projects", pid)
        S.db.delete("projects", pid)
        S.bus.changed("project", pid)
        return {"ok": True, "note": "Removed from ATLAS. Files on disk were not touched."}

    @app.get("/api/projects/{pid}/git")
    async def project_git(pid: str):
        p = must("projects", pid)
        return gitops.info(Path(p["path"]))

    @app.post("/api/projects/{pid}/git-init")
    async def project_git_init(pid: str):
        p = must("projects", pid)
        path = Path(p["path"])
        if not gitops.is_repo(path):
            gitops.git(path, "init", "-b", "main")
        if not gitops.has_commits(path):
            gitops.git(path, "add", "-A")
            gitops.git(path, "-c", "user.name=ATLAS Harness", "-c", "user.email=atlas@localhost", "commit",
                       "--allow-empty", "-m", "Initial commit (ATLAS Harness)")
        S.db.audit("user", "git_init", {"project": pid})
        return gitops.info(path)

    @app.get("/api/projects/{pid}/tree")
    async def project_tree(pid: str, path: str = "."):
        p = must("projects", pid)
        try:
            d = resolve_in_workspace(Path(p["path"]), path, block_secrets=False)
        except PermissionDenied as e:
            err(e, 403)
        entries = []
        for e in sorted(d.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))[:500]:
            if e.name in (".git", "node_modules", ".DS_Store", "__pycache__", ".venv"):
                continue
            entries.append({"name": e.name, "dir": e.is_dir(), "path": str(e.relative_to(Path(p["path"]).resolve()))})
        return entries

    @app.get("/api/projects/{pid}/file")
    async def project_file(pid: str, path: str):
        p = must("projects", pid)
        try:
            f = resolve_in_workspace(Path(p["path"]), path)
        except PermissionDenied as e:
            err(e, 403)
        if not f.is_file() or f.stat().st_size > 1_000_000:
            raise HTTPException(400, "Not a readable text file under 1 MB")
        return {"path": path, "content": f.read_text(errors="replace")}

    # ------------------------------------------------------------ tasks
    def task_view(t, full=False):
        agent = S.db.get("agents", t["agent_id"]) if t.get("agent_id") else None
        team = S.db.get("teams", t["team_id"]) if t.get("team_id") else None
        v = {**t, "agent_name": agent["name"] if agent else None, "agent_model": agent["model"] if agent else None,
             "team_name": team["name"] if team else None}
        if full:
            v["transitions"] = S.db.q("SELECT * FROM task_transitions WHERE task_id=? ORDER BY id", (t["id"],))
            v["children"] = [task_view(c) for c in S.db.q("SELECT * FROM tasks WHERE parent_id=? ORDER BY created_at", (t["id"],))]
            v["approvals"] = S.db.q("SELECT * FROM approvals WHERE task_id=? ORDER BY created_at DESC", (t["id"],))
            v["messages"] = S.db.q("SELECT * FROM messages WHERE task_id=? ORDER BY at", (t["id"],))
        return v

    # ------------------------------------------------------------ conversations (chat-first UI)
    def chat_call(fn, *a):
        try:
            return fn(*a)
        except KeyError as e:
            raise HTTPException(404, str(e).strip("'"))
        except (ChatError, ValueError) as e:
            raise HTTPException(400, str(e))

    @app.get("/api/conversations")
    async def conversations(q: str = "", limit: int = 300):
        return S.chat.list(q, min(limit, 1000))

    @app.post("/api/conversations")
    async def create_conversation(body: Dict[str, Any] = Body(default={})):
        return S.chat.create(body.get("title"), body.get("config"))

    @app.get("/api/conversations/{cid}")
    async def conversation(cid: str):
        return chat_call(S.chat.view, cid)

    @app.patch("/api/conversations/{cid}")
    async def patch_conversation(cid: str, body: Dict[str, Any] = Body(...)):
        return chat_call(S.chat.patch, cid, body)

    @app.delete("/api/conversations/{cid}")
    async def delete_conversation(cid: str):
        chat_call(S.chat.delete, cid)
        return {"ok": True}

    @app.post("/api/open")
    async def open_path(body: Dict[str, Any] = Body(...)):
        """Open a file or folder mentioned in a reply: files open in their default app, folders in Finder;
        reveal=True selects the item in Finder instead. Relative paths resolve against the run's worktree,
        then its project, then the chat's project."""
        raw = str(body.get("path") or "").strip()
        raw = re.sub(r"(:\d+)+$", "", raw)   # "src/app.ts:42" -> "src/app.ts"
        if not raw or "\x00" in raw:
            raise HTTPException(400, "No path given.")
        bases: List[Path] = []
        task = S.db.get("tasks", str(body.get("task_id") or "")) if body.get("task_id") else None
        if task and task.get("worktree"):
            bases.append(Path(task["worktree"]))
        for pid in [task.get("project_id") if task else None, body.get("project_id")]:
            proj = S.db.get("projects", pid) if pid else None
            if proj and proj.get("path"):
                bases.append(Path(proj["path"]))
        candidate = Path(raw).expanduser()
        options = [candidate] if candidate.is_absolute() else [b / candidate for b in bases]
        home = Path.home().resolve()
        target = next((p.resolve() for p in options if p.exists()), None)
        if not target:
            raise HTTPException(404, f"Couldn't find {raw}.")
        if target != home and home not in target.parents and not any(b.resolve() in target.parents or b.resolve() == target for b in bases):
            raise HTTPException(403, "Atlas only opens files in your home folder or this project.")
        args = ["open", "-R", str(target)] if body.get("reveal") else ["open", str(target)]
        await asyncio.to_thread(subprocess.run, args, check=False)
        return {"ok": True, "path": str(target), "is_dir": target.is_dir()}

    @app.post("/api/uploads")
    async def upload(request: Request, name: str = "file", id: str = "", offset: int = 0):
        """Stream a large attachment to disk, whole or in chunks (id + offset append to an earlier chunk).
        The chat then refers to it by id instead of sending its bytes."""
        from .chat import MAX_UPLOAD_BYTES, uploads_dir
        if id:
            if not re.fullmatch(r"up_[a-f0-9]{12}", id):
                raise HTTPException(404, "Upload not found. Attach the file again.")
            folder = uploads_dir() / Path(id).name
            files = [f for f in folder.iterdir() if f.is_file()] if folder.is_dir() else []
            if folder.is_symlink() or not files or len(files) != 1 or files[0].is_symlink():
                raise HTTPException(404, "Upload not found. Attach the file again.")
            dest, fresh = files[0], False
            if dest.stat().st_size != offset:
                raise HTTPException(409, f"Upload is at {dest.stat().st_size} bytes, not {offset}.")
        else:
            uid = new_id("up")
            folder = uploads_dir() / uid
            folder.mkdir(parents=True, mode=0o700)
            dest, fresh = folder / (Path(name).name.strip() or "file"), True
        size = dest.stat().st_size if dest.exists() else 0
        if size + int(request.headers.get("content-length") or 0) > MAX_UPLOAD_BYTES:
            if fresh:
                shutil.rmtree(folder, ignore_errors=True)
            raise HTTPException(413, "Files can be up to 2 GB.")
        try:
            fd = os.open(dest, os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "ab") as f:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > MAX_UPLOAD_BYTES:
                        raise HTTPException(413, "Files can be up to 2 GB.")
                    f.write(chunk)
        except BaseException:
            if fresh:
                shutil.rmtree(folder, ignore_errors=True)
            raise
        return {"id": folder.name, "name": dest.name, "size": size}

    @app.post("/api/conversations/{cid}/messages")
    async def send_message(cid: str, body: Dict[str, Any] = Body(...)):
        return chat_call(S.chat.send, cid, body.get("content", ""), body.get("attachments"), body.get("config"))

    @app.post("/api/conversations/{cid}/stop")
    async def stop_conversation(cid: str):
        chat_call(S.chat.stop, cid)
        return {"ok": True}

    @app.get("/api/tasks")
    async def tasks(team_id: Optional[str] = None, status: Optional[str] = None, parent_id: Optional[str] = None,
              agent_id: Optional[str] = None, limit: int = 500):
        sql, args = "SELECT * FROM tasks WHERE 1=1", []
        for col, val in (("team_id", team_id), ("status", status), ("parent_id", parent_id), ("agent_id", agent_id)):
            if val:
                sql += f" AND {col}=?"
                args.append(val)
        sql += " ORDER BY created_at DESC LIMIT ?"
        args.append(min(limit, 2000))
        return [task_view(t) for t in S.db.q(sql, args)]

    @app.post("/api/objectives")
    async def objective(body: Dict[str, Any] = Body(...)):
        if not (body.get("objective") or "").strip():
            raise HTTPException(400, "objective is required")
        try:
            return task_view(S.orch.submit_objective(body["team_id"], body["objective"], body.get("project_id"),
                                                     body.get("title"), int(body.get("priority", 2))))
        except KeyError as e:
            err(e, 404)

    @app.post("/api/tasks")
    async def create_task(body: Dict[str, Any] = Body(...)):
        if not body.get("title"):
            raise HTTPException(400, "title is required")
        try:
            return task_view(S.orch.create_task(body))
        except (KeyError, ValueError) as e:
            err(e)

    @app.get("/api/tasks/{tid}")
    async def get_task(tid: str):
        return task_view(must("tasks", tid), full=True)

    @app.patch("/api/tasks/{tid}")
    async def patch_task(tid: str, body: Dict[str, Any] = Body(...)):
        t = must("tasks", tid)
        if t["status"] in ("running", "planning", "reviewing"):
            raise HTTPException(409, "Cannot edit a task while it is executing.")
        upd = {k: v for k, v in body.items() if k in ("title", "description", "priority", "agent_id", "deps", "acceptance", "needs_approval")}
        upd["updated_at"] = now()
        S.db.update("tasks", tid, upd)
        if "deps" in upd and S.orch._has_cycle(tid):
            S.db.update("tasks", tid, {"deps": t["deps"]})
            raise HTTPException(400, "Dependencies would create a cycle.")
        S.bus.changed("task", tid)
        S.orch.poke()
        return task_view(S.db.get("tasks", tid))

    @app.post("/api/tasks/{tid}/cancel")
    async def cancel_task(tid: str):
        must("tasks", tid)
        S.orch.cancel(tid)
        return {"ok": True}

    @app.post("/api/tasks/{tid}/retry")
    async def retry_task(tid: str):
        must("tasks", tid)
        try:
            return task_view(S.orch.retry(tid))
        except InvalidTransition as e:
            err(e, 409)

    @app.post("/api/tasks/{tid}/approve-plan")
    async def approve_plan(tid: str, body: Dict[str, Any] = Body(...)):
        try:
            S.orch.approve_plan(tid, bool(body.get("approved")))
        except InvalidTransition as e:
            err(e, 409)
        return {"ok": True}

    @app.delete("/api/tasks/{tid}")
    async def delete_task(tid: str):
        t = must("tasks", tid)
        if t["status"] not in ("completed", "failed", "cancelled", "queued", "blocked"):
            raise HTTPException(409, "Cancel the task before deleting it.")
        for c in S.db.q("SELECT id FROM tasks WHERE parent_id=?", (tid,)):
            await delete_task(c["id"])
        if t.get("worktree") and t.get("project_id"):
            p = S.db.get("projects", t["project_id"])
            if p and not (t.get("artifacts") or {}).get("merged"):
                gitops.remove_worktree(Path(p["path"]), t["worktree"], t.get("branch"), delete_branch=False)
        S.db.delete("tasks", tid)
        S.bus.changed("task", tid)
        return {"ok": True, "note": "Task branch kept; delete it with git if no longer needed."}

    # ------------------------------------------------------------ media previews (images, 3D models)
    MEDIA_KINDS = {".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image", ".svg": "image",
                   ".glb": "model", ".gltf": "model", ".obj": "model", ".stl": "model", ".ply": "model"}
    MAX_MEDIA_BYTES = 60 * 1024 * 1024

    def media_roots(t: Dict[str, Any]) -> List[Path]:
        """Where a run's files live: its isolated worktree first, then the project folder."""
        roots: List[Path] = []
        if t.get("worktree") and Path(t["worktree"]).is_dir():
            roots.append(Path(t["worktree"]))
        p = S.db.get("projects", t["project_id"]) if t.get("project_id") else None
        if p and Path(p["path"]).is_dir():
            roots.append(Path(p["path"]))
        return roots

    def media_kind(path: str) -> Optional[str]:
        return MEDIA_KINDS.get(Path(path).suffix.lower())

    @app.get("/api/tasks/{tid}/media")
    async def task_media(tid: str):
        """Images and 3D models a run created or changed, newest first (for inline previews)."""
        root_task = must("tasks", tid)
        tasks = [root_task] + S.db.q("SELECT * FROM tasks WHERE parent_id=?", (tid,))
        found: Dict[str, Dict[str, Any]] = {}
        for t in tasks:
            roots = media_roots(t)
            names = set((t.get("artifacts") or {}).get("files") or [])
            in_place = not (t.get("worktree") and Path(t["worktree"]).is_dir())
            for root in roots[:1]:
                if gitops.is_repo(root):
                    for st in await asyncio.to_thread(gitops.status, root):
                        names.add(st["path"].split(" -> ")[-1].strip('"'))
            since = (t.get("started_at") or t.get("created_at") or 0) - 2
            for rel in names:
                kind = media_kind(rel)
                if not kind:
                    continue
                for root in roots:
                    try:
                        f = resolve_in_workspace(root, rel)
                    except PermissionDenied:
                        continue
                    if not f.is_file():
                        continue
                    stat = f.stat()
                    # in the shared project folder, only files this run touched (not older edits of yours)
                    if in_place and stat.st_mtime < since:
                        break
                    if stat.st_size <= MAX_MEDIA_BYTES:
                        found[f"{t['id']}:{rel}"] = {"task_id": t["id"], "path": rel, "name": f.name, "kind": kind,
                                                     "size": stat.st_size, "mtime": stat.st_mtime}
                    break
        return sorted(found.values(), key=lambda m: -m["mtime"])[:24]

    @app.get("/api/tasks/{tid}/file")
    async def task_file(tid: str, path: str):
        """Serve one preview file from a run's workspace (media types only, never outside it)."""
        t = must("tasks", tid)
        if not media_kind(path):
            raise HTTPException(415, "Only images and 3D models can be previewed.")
        for root in media_roots(t):
            try:
                f = resolve_in_workspace(root, path)
            except PermissionDenied as e:
                err(e, 403)
            if f.is_file():
                if f.stat().st_size > MAX_MEDIA_BYTES:
                    raise HTTPException(413, "File is too large to preview.")
                types = {".svg": "image/svg+xml", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
                         ".obj": "text/plain", ".stl": "model/stl", ".ply": "application/octet-stream"}
                return FileResponse(f, media_type=types.get(f.suffix.lower()),
                                    headers={"Cache-Control": "no-cache", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"})
        raise HTTPException(404, "File not found in this run's workspace.")

    @app.get("/api/tasks/{tid}/diff")
    async def task_diff(tid: str):
        t = must("tasks", tid)
        a = t.get("artifacts") or {}
        if not a.get("branch") or not t.get("project_id"):
            return {"diff": "", "files": a.get("files", [])}
        p = S.db.get("projects", t["project_id"])
        return {"diff": gitops.diff(Path(p["path"]), a["base"], a["branch"])[:400000], "files": a.get("files", []),
                "branch": a["branch"]}

    @app.get("/api/tasks/{tid}/merge-preview")
    async def merge_preview(tid: str):
        t = must("tasks", tid)
        if not t.get("branch"):
            raise HTTPException(400, "Task has no branch")
        p = S.db.get("projects", t["project_id"])
        prev = gitops.merge_preview(Path(p["path"]), t["branch"])
        prev["protected"] = prev["target"] in (S.db.setting("permissions.protected_branches") or [])
        prev["dirty"] = gitops.status(Path(p["path"]))
        return prev

    @app.post("/api/tasks/{tid}/merge")
    async def merge(tid: str, body: Dict[str, Any] = Body(default={})):
        try:
            return S.orch.merge_task(tid, bool(body.get("confirm_protected")))
        except (gitops.GitError, RuntimeError) as e:
            err(e, 409)

    @app.post("/api/tasks/{tid}/rollback")
    async def rollback(tid: str):
        try:
            return S.orch.rollback_merge(tid)
        except (gitops.GitError, RuntimeError) as e:
            err(e, 409)

    # ------------------------------------------------------------ approvals, events, messages, memory
    @app.get("/api/approvals")
    async def approvals(status: str = "pending"):
        rows = S.db.q("SELECT * FROM approvals WHERE status=? ORDER BY created_at DESC LIMIT 200", (status,))
        out = []
        for a in rows:
            t = S.db.get("tasks", a["task_id"]) if a.get("task_id") else None
            ag = S.db.get("agents", a["agent_id"]) if a.get("agent_id") else None
            out.append({**a, "task_title": t["title"] if t else None, "agent_name": ag["name"] if ag else None})
        plans = S.db.q("SELECT * FROM tasks WHERE kind='objective' AND status='waiting_approval'") if status == "pending" else []
        for p in plans:
            out.append({"id": f"plan:{p['id']}", "task_id": p["id"], "kind": "plan", "status": "pending",
                        "payload": {"plan": (p.get("artifacts") or {}).get("plan")}, "created_at": p["updated_at"],
                        "task_title": p["title"], "agent_name": None})
        return out

    @app.post("/api/approvals/{aid}")
    async def decide(aid: str, body: Dict[str, Any] = Body(...)):
        if aid.startswith("plan:"):
            await approve_plan(aid[5:], body)
            return {"ok": True}
        try:
            return S.orch.decide(aid, bool(body.get("approved")), body.get("note", ""), bool(body.get("always")))
        except InvalidTransition as e:
            err(e, 409)

    @app.post("/api/approvals/{aid}/answer")
    async def answer_question(aid: str, body: Dict[str, Any] = Body(...)):
        try:
            return S.orch.answer_question(aid, body.get("answer", ""))
        except InvalidTransition as e:
            err(e, 409)
        except ValueError as e:
            err(e, 400)

    @app.get("/api/computer/next")
    async def next_computer_request():
        return await S.computer.next_request()

    @app.get("/api/computer/{rid}/active")
    async def computer_request_active(rid: str):
        return {"active": S.computer.is_active(rid)}

    @app.post("/api/computer/{rid}/respond")
    async def respond_computer_request(rid: str, body: Dict[str, Any] = Body(...)):
        try:
            S.computer.respond(rid, body.get("result"))
            return {"ok": True}
        except ComputerUseError as e:
            err(e, 409)

    @app.get("/api/events")
    async def events(task_id: Optional[str] = None, team_id: Optional[str] = None, agent_id: Optional[str] = None,
               type: Optional[str] = None, before: Optional[int] = None, limit: int = 300, include_children: bool = False):
        sql, args = "SELECT * FROM events WHERE 1=1", []
        if task_id and include_children:
            ids = [task_id] + [c["id"] for c in S.db.q("SELECT id FROM tasks WHERE parent_id=?", (task_id,))]
            sql += f" AND task_id IN ({','.join('?' * len(ids))})"
            args += ids
        elif task_id:
            sql += " AND task_id=?"
            args.append(task_id)
        for col, val in (("team_id", team_id), ("agent_id", agent_id)):
            if val:
                sql += f" AND {col}=?"
                args.append(val)
        if type:
            types = type.split(",")
            sql += f" AND type IN ({','.join('?' * len(types))})"
            args += types
        if before:
            sql += " AND id<?"
            args.append(before)
        sql += " ORDER BY id DESC LIMIT ?"
        args.append(min(limit, 2000))
        return S.db.q(sql, args)[::-1]

    @app.get("/api/messages")
    async def messages(team_id: Optional[str] = None, task_id: Optional[str] = None, limit: int = 200):
        sql, args = "SELECT * FROM messages WHERE 1=1", []
        if team_id:
            sql += " AND team_id=?"
            args.append(team_id)
        if task_id:
            sql += " AND task_id=?"
            args.append(task_id)
        sql += " ORDER BY at DESC LIMIT ?"
        args.append(limit)
        return S.db.q(sql, args)

    @app.get("/api/memory")
    async def memory(scope: str, scope_id: str):
        return S.db.q("SELECT * FROM memory WHERE scope=? AND scope_id=? ORDER BY verified DESC, updated_at DESC", (scope, scope_id))

    @app.post("/api/memory")
    async def add_memory(body: Dict[str, Any] = Body(...)):
        if body.get("scope") not in ("agent", "team", "project"):
            raise HTTPException(400, "scope must be agent, team or project")
        m = S.db.insert("memory", {"id": new_id("mem"), "scope": body["scope"], "scope_id": body["scope_id"],
                                   "key": body.get("key") or "note", "content": body.get("content", ""), "source": "user",
                                   "verified": 1 if body.get("verified", True) else 0, "created_at": now(), "updated_at": now()})
        S.bus.changed("memory", body["scope_id"])
        return m

    @app.patch("/api/memory/{mid}")
    async def patch_memory(mid: str, body: Dict[str, Any] = Body(...)):
        must("memory", mid)
        upd = {k: v for k, v in body.items() if k in ("key", "content", "verified")}
        upd["updated_at"] = now()
        m = S.db.update("memory", mid, upd)
        S.bus.changed("memory", m["scope_id"])
        return m

    @app.delete("/api/memory/{mid}")
    async def delete_memory(mid: str):
        m = must("memory", mid)
        S.db.delete("memory", mid)
        S.bus.changed("memory", m["scope_id"])
        return {"ok": True}

    # ------------------------------------------------------------ monitoring & overview
    @app.get("/api/hardware")
    async def hardware_ep():
        d = str(S.db.setting("models.ollama_dir") or "").strip() or str(Path.home() / ".ollama")
        return await asyncio.to_thread(monitor.hardware, d)

    @app.get("/api/monitor")
    async def monitor_ep():
        snap = monitor.snapshot()
        loaded = []
        for p in S.router.providers.values():
            if p.kind == "ollama":
                for m in await p.loaded():  # type: ignore[attr-defined]
                    loaded.append({"provider_id": p.id, "name": m.get("name"), "size_bytes": m.get("size"),
                                   "vram_bytes": m.get("size_vram"), "measured": True})
        provs = S.db.q("SELECT id, name, kind, status, last_error FROM providers WHERE enabled=1")
        snap.update({
            "loaded_models": loaded,
            "active_inference": S.router.active_inference(),
            "inference_limit": int(S.db.setting("execution.max_concurrent_inference")),
            "running_agents": S.db.one("SELECT COUNT(*) n FROM agents WHERE status IN ('running','waiting')")["n"],
            "running_tasks": len(S.orch.running),
            "task_limit": int(S.db.setting("execution.max_concurrent_tasks")),
            "queue_length": S.db.one("SELECT COUNT(*) n FROM tasks WHERE status IN ('queued','ready')")["n"],
            "errors_last_hour": S.db.one("SELECT COUNT(*) n FROM events WHERE type='error' AND at>?", (time.time() - 3600,))["n"],
            "providers": [{**p, "stats": (S.router.providers[p["id"]].stats() if p["id"] in S.router.providers else None)} for p in provs],
            "mcp": S.mcp.status(),
        })
        return snap

    @app.get("/api/overview")
    async def overview():
        q1 = lambda sql, a=(): S.db.one(sql, a)["n"]  # noqa: E731
        metrics = {
            "active_teams": q1("SELECT COUNT(DISTINCT team_id) n FROM tasks WHERE status IN ('planning','running','reviewing','waiting_approval','ready','queued')"),
            "running_agents": q1("SELECT COUNT(*) n FROM agents WHERE status IN ('running','waiting')"),
            "tasks_in_progress": q1("SELECT COUNT(*) n FROM tasks WHERE status IN ('planning','running','reviewing')"),
            "awaiting_approval": q1("SELECT COUNT(*) n FROM approvals WHERE status='pending'") +
                                 q1("SELECT COUNT(*) n FROM tasks WHERE kind='objective' AND status='waiting_approval'"),
            "teams": q1("SELECT COUNT(*) n FROM teams WHERE archived=0"),
            "agents": q1("SELECT COUNT(*) n FROM agents"),
            "providers": q1("SELECT COUNT(*) n FROM providers WHERE enabled=1"),
            "projects": q1("SELECT COUNT(*) n FROM projects"),
        }
        teams_rows = [team_view(t) for t in S.db.q("SELECT * FROM teams WHERE archived=0 ORDER BY updated_at DESC LIMIT 8")]
        timeline = S.db.q("SELECT tt.*, t.title, t.team_id FROM task_transitions tt JOIN tasks t ON t.id=tt.task_id "
                          "ORDER BY tt.id DESC LIMIT 40")
        recent = S.db.q("SELECT * FROM events WHERE type IN ('task_status','plan_created','completion_report','approval_requested',"
                        "'error','final_report','merged','conflict_detected','objective_submitted') ORDER BY id DESC LIMIT 30")
        return {"metrics": metrics, "teams": teams_rows, "timeline": timeline, "recent": recent}

    @app.get("/api/mcp")
    async def mcp_status():
        tools = await S.mcp.list_tools() if S.mcp.enabled else []
        return {"servers": S.mcp.status(), "tools": tools}

    @app.get("/api/audit")
    async def audit(limit: int = 200):
        return S.db.q("SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,))

    @app.get("/api/search")
    async def search(q: str):
        like = f"%{q}%"
        return {
            "teams": S.db.q("SELECT id, name FROM teams WHERE name LIKE ? AND archived=0 LIMIT 8", (like,)),
            "agents": S.db.q("SELECT id, name, role FROM agents WHERE name LIKE ? OR role LIKE ? LIMIT 8", (like, like)),
            "tasks": S.db.q("SELECT id, title, status FROM tasks WHERE title LIKE ? ORDER BY created_at DESC LIMIT 8", (like,)),
            "projects": S.db.q("SELECT id, name FROM projects WHERE name LIKE ? LIMIT 8", (like,)),
        }

    # ------------------------------------------------------------ websocket
    @app.websocket("/api/ws")
    async def ws(socket: WebSocket):
        if not hmac.compare_digest(socket.query_params.get("token", ""), token):
            await socket.close(code=4401)
            return
        await socket.accept()
        q = S.bus.subscribe()
        try:
            while True:
                msg = await q.get()
                batch = [msg]
                while not q.empty() and len(batch) < 100:
                    batch.append(q.get_nowait())
                await socket.send_json(batch)
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            S.bus.unsubscribe(q)

    # ------------------------------------------------------------ static UI
    if static_dir and static_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(static_dir / "assets")), name="assets")

        @app.get("/{full_path:path}")
        async def spa(full_path: str):
            f = (static_dir / full_path).resolve()
            if full_path and static_dir.resolve() in f.parents and f.is_file():
                return FileResponse(str(f))
            return FileResponse(str(static_dir / "index.html"), headers={"Cache-Control": "no-cache"})

    return app


_ = os
