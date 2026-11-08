"""Model router: provider registry, shared inference queues, and model service control."""
from __future__ import annotations

import asyncio
import os
import platform
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

from ..config import bin_dir, logs_dir
from ..db import DB, new_id, now
from ..security import load_secret
from .anthropic import AnthropicProvider
from .base import ChatResult, ModelInfo, Provider, ProviderError
from .cli_agents import ClaudeCodeProvider, CodexProvider, HermesProvider, find_binary
from .ollama import OllamaProvider
from .openai_compat import OpenAICompatProvider

KINDS = {
    "ollama": OllamaProvider,
    "openai_compat": OpenAICompatProvider,  # MLX-LM, llama.cpp, LM Studio, vLLM, OpenRouter, OpenAI (Codex models)
    "anthropic": AnthropicProvider,
    "claude_code": ClaudeCodeProvider,
    "codex_cli": CodexProvider,
    "hermes_cli": HermesProvider,
}

KIND_LABELS = {
    "ollama": "Ollama", "openai_compat": "OpenAI-compatible", "anthropic": "Claude API",
    "claude_code": "Claude Code", "codex_cli": "Codex CLI", "hermes_cli": "Atlas Runtime",
}


# Fallback context windows for providers that don't report one. Matched on the lowercase model
# name, first hit wins, so specific names come first. Values are the vendors' published sizes.
KNOWN_CONTEXT = [
    ("gemini-1.5-pro", 2_000_000), ("gemini", 1_000_000), ("fable", 1_000_000), ("opus", 1_000_000),
    ("sonnet", 1_000_000), ("haiku", 200_000), ("claude", 200_000), ("gpt-4.1", 1_000_000), ("gpt-5", 400_000),
    ("gpt-4o", 128_000), ("gpt-4", 128_000), ("o1", 200_000), ("o3", 200_000), ("o4", 200_000), ("codex", 400_000),
    ("deepseek", 128_000), ("kimi", 256_000), ("qwen3-coder", 256_000), ("qwen", 131_072), ("glm", 128_000),
    ("llama-3.1", 128_000), ("llama-3.3", 128_000), ("llama-4", 1_000_000), ("llama", 128_000),
    ("mistral-large", 128_000), ("mixtral", 32_768), ("mistral", 32_768), ("grok", 256_000), ("gemma", 128_000),
    ("phi", 128_000), ("minimax", 1_000_000), ("command-r", 128_000),
]


def known_context(name: Optional[str]) -> Optional[int]:
    n = (name or "").lower()
    return next((size for key, size in KNOWN_CONTEXT if key in n), None)


class ModelRouter:
    def __init__(self, db: DB):
        self.db = db
        self.providers: Dict[str, Provider] = {}
        self.semaphores: Dict[str, asyncio.Semaphore] = {}
        self.ollama_proc: Optional[subprocess.Popen] = None
        self.reload()

    # ---- registry
    def reload(self) -> None:
        self.providers = {}
        for row in self.db.q("SELECT * FROM providers WHERE enabled=1"):
            cls = KINDS.get(row["kind"])
            if not cls:
                continue
            secret = None
            if (row.get("config") or {}).get("has_secret"):
                secret = load_secret(f"provider:{row['id']}")
            env_key = (row.get("config") or {}).get("api_key_env")
            if not secret and env_key:
                secret = os.environ.get(env_key)
            self.providers[row["id"]] = cls(row, secret)
        limit = int(self.db.setting("execution.max_concurrent_inference") or 2)
        for pid in self.providers:
            if pid not in self.semaphores or getattr(self.semaphores[pid], "_atlas_limit", None) != limit:
                sem = asyncio.Semaphore(limit)
                sem._atlas_limit = limit  # type: ignore[attr-defined]
                self.semaphores[pid] = sem

    def get(self, provider_id: Optional[str]) -> Provider:
        if not provider_id or provider_id not in self.providers:
            raise ProviderError(f"Provider '{provider_id}' is not configured or is disabled.", retryable=False)
        return self.providers[provider_id]

    def ensure_defaults(self) -> None:
        """Seed providers that exist on this machine. Nothing is assumed to be running."""
        existing = {r["kind"] for r in self.db.q("SELECT kind FROM providers")}
        t = now()
        seeds = []
        if "ollama" not in existing:
            seeds.append(("ollama", "Ollama", self.db.setting("models.ollama_url"), {}))
        if "claude_code" not in existing and find_binary("claude"):
            seeds.append(("claude_code", "Claude Code", None, {}))
        if "codex_cli" not in existing and find_binary("codex"):
            seeds.append(("codex_cli", "Codex CLI", None, {}))
        if "hermes_cli" not in existing and find_binary("hermes"):
            seeds.append(("hermes_cli", "Atlas Runtime", None, {}))
        for kind, name, url, cfg in seeds:
            self.db.insert("providers", {"id": new_id("prov"), "kind": kind, "name": name, "base_url": url,
                                         "config": cfg, "enabled": 1, "created_at": t, "updated_at": t})
        if seeds:
            self.reload()

    # ---- inference with shared queue + bounded retry
    async def chat(self, provider_id: str, model: str, messages: List[Dict[str, Any]], *, retries: int = 2,
                   on_wait=None, **kw) -> ChatResult:
        prov = self.get(provider_id)
        sem = self.semaphores[provider_id]
        attempt = 0
        while True:
            if sem.locked() and on_wait:
                await on_wait()
            async with sem:
                prov.active_requests += 1
                prov.total_requests += 1
                try:
                    res = await prov.chat(model, messages, **kw)
                    prov.last_latency_ms = res.latency_ms
                    self._set_status(provider_id, "connected", None)
                    return res
                except ProviderError as e:
                    prov.errors += 1
                    self._set_status(provider_id, "failed", str(e))
                    if not e.retryable or attempt >= retries:
                        raise
                finally:
                    prov.active_requests -= 1
            attempt += 1
            await asyncio.sleep(min(2 ** attempt, 10))

    def _set_status(self, pid: str, status: str, err: Optional[str]) -> None:
        row = self.db.get("providers", pid)
        if row and (row["status"] != status or row["last_error"] != err):
            self.db.update("providers", pid, {"status": status, "last_error": err, "updated_at": now()})

    async def health_all(self) -> Dict[str, Any]:
        out = {}
        async def one(pid, p):
            h = await p.health()
            self._set_status(pid, "connected" if h.get("ok") else "unavailable", None if h.get("ok") else h.get("error"))
            out[pid] = h
        await asyncio.gather(*(one(pid, p) for pid, p in self.providers.items()))
        return out

    async def models(self) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        async def one(p: Provider):
            try:
                for m in await p.list_models():
                    d = m.to_dict()
                    if not d.get("context_length") and d.get("name"):
                        guess = known_context(d["name"])
                        if guess:
                            d["context_length"] = guess
                            d["details"] = {**(d.get("details") or {}), "context_estimated": True}
                    d["provider_name"] = p.name
                    d["provider_kind"] = p.kind
                    d["provider_preset_id"] = (p.config or {}).get("preset_id")
                    results.append(d)
            except ProviderError as e:
                results.append({"name": None, "provider_id": p.id, "provider_name": p.name, "provider_kind": p.kind,
                                "state": "unavailable", "error": str(e)})
        await asyncio.gather(*(one(p) for p in self.providers.values()))
        return results

    async def probe(self, provider_id: str, model: str) -> Dict[str, Any]:
        """Verify tool calling + structured output with real requests; never inferred from the model name."""
        caps: Dict[str, Any] = {}
        tool = {"name": "ping", "description": "Return pong. Call this tool when asked to ping.",
                "parameters": {"type": "object", "properties": {"note": {"type": "string"}}, "required": []}}

        async def check_tools():
            try:
                r = await self.chat(provider_id, model, [{"role": "user", "content": "Call the ping tool now."}],
                                    tools=[tool], params={"temperature": 0, "max_tokens": 96}, retries=0)
                return {"tools": any(tc["name"] == "ping" for tc in r.tool_calls), "latency_ms": round(r.latency_ms)}
            except ProviderError as e:
                return {"tools": False, "tools_error": str(e)[:300]}

        async def check_structured():
            try:
                r = await self.chat(provider_id, model, [{"role": "user", "content": 'Reply with JSON {"ok": true} only.'}],
                                    params={"temperature": 0, "max_tokens": 32}, json_mode=True, retries=0)
                import json as _j
                txt = r.text.strip().strip("`").replace("json\n", "", 1)
                return {"structured": isinstance(_j.loads(txt[txt.find("{"): txt.rfind("}") + 1]), dict)}
            except Exception:  # noqa: BLE001
                return {"structured": False}

        tool_result, structured_result = await asyncio.gather(check_tools(), check_structured())
        caps.update(tool_result)
        caps.update(structured_result)
        caps["streaming"] = True
        caps["probed_at"] = now()
        row = self.db.get("providers", provider_id)
        cfg = row["config"] or {}
        cfg.setdefault("model_caps", {})[model] = caps
        self.db.update("providers", provider_id, {"config": cfg, "updated_at": now()})
        self.reload()
        return caps

    def stats(self) -> Dict[str, Any]:
        return {pid: p.stats() for pid, p in self.providers.items()}

    def active_inference(self) -> int:
        return sum(p.active_requests for p in self.providers.values())

    # ---- Ollama service control (user-local; no admin rights)
    def ollama_binary(self) -> Optional[str]:
        b = find_binary("ollama")
        if b:
            return b
        app = Path("/Applications/Ollama.app/Contents/Resources/ollama")
        if app.exists():
            return str(app)
        app = Path.home() / "Applications/Ollama.app/Contents/Resources/ollama"
        return str(app) if app.exists() else None

    async def install_ollama(self, progress=None) -> str:
        """Download the official Ollama macOS build from GitHub releases into the app's data folder."""
        if platform.system() != "Darwin":
            raise ProviderError("Automatic Ollama install is only implemented for macOS.", retryable=False)
        url = "https://github.com/ollama/ollama/releases/latest/download/ollama-darwin.tgz"
        dest = bin_dir() / "ollama-dist"
        dest.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory() as td:
            tgz = Path(td) / "ollama-darwin.tgz"
            async with httpx.AsyncClient(follow_redirects=True, timeout=httpx.Timeout(30, read=600)) as c:
                async with c.stream("GET", url) as r:
                    r.raise_for_status()
                    total = int(r.headers.get("content-length") or 0)
                    done = 0
                    with open(tgz, "wb") as f:
                        async for chunk in r.aiter_bytes(1 << 20):
                            f.write(chunk)
                            done += len(chunk)
                            if progress:
                                await progress({"downloaded": done, "total": total})
            with tarfile.open(tgz) as tf:
                for m in tf.getmembers():
                    target = (dest / m.name).resolve()
                    if dest.resolve() not in target.parents and target != dest.resolve():
                        raise ProviderError("Refusing to extract an archive entry outside the target folder.")
                tf.extractall(dest)
        exe = next((p for p in dest.rglob("ollama") if p.is_file() and os.access(p, os.X_OK)), None)
        if not exe:
            raise ProviderError("Downloaded archive did not contain an ollama executable.")
        link = bin_dir() / "ollama"
        if link.exists() or link.is_symlink():
            link.unlink()
        link.symlink_to(exe)
        subprocess.run(["xattr", "-dr", "com.apple.quarantine", str(dest)], capture_output=True)
        return str(link)

    async def start_ollama(self) -> Dict[str, Any]:
        prov = next((p for p in self.providers.values() if p.kind == "ollama"), None)
        if prov and (await prov.health()).get("ok"):
            return {"ok": True, "already_running": True}
        b = self.ollama_binary()
        if not b:
            return {"ok": False, "error": "Ollama is not installed.", "installable": True}
        env = dict(os.environ)
        env.setdefault("OLLAMA_HOST", "127.0.0.1:11434")
        env.setdefault("OLLAMA_MAX_LOADED_MODELS", "1")  # 24 GB machines: share one loaded model across agents
        model_dir = str(self.db.setting("models.ollama_dir") or "").strip()
        if model_dir:
            model_path = Path(model_dir).expanduser()
            model_path.mkdir(parents=True, exist_ok=True)
            env["OLLAMA_MODELS"] = str(model_path)
        log = open(logs_dir() / "ollama.log", "ab")
        self.ollama_proc = subprocess.Popen([b, "serve"], stdout=log, stderr=log, env=env, start_new_session=True)
        for _ in range(40):
            await asyncio.sleep(0.25)
            if prov and (await prov.health()).get("ok"):
                return {"ok": True, "pid": self.ollama_proc.pid}
        return {"ok": False, "error": "Ollama did not become ready; see logs/ollama.log."}

    def stop_ollama(self) -> Dict[str, Any]:
        if self.ollama_proc and self.ollama_proc.poll() is None:
            self.ollama_proc.terminate()
            try:
                self.ollama_proc.wait(5)
            except subprocess.TimeoutExpired:
                self.ollama_proc.kill()
            self.ollama_proc = None
            return {"ok": True}
        return {"ok": False, "error": "Ollama was not started by ATLAS; stop it from its own menu-bar app."}


__all__ = ["ModelRouter", "KINDS", "KIND_LABELS", "ProviderError", "ChatResult", "ModelInfo", "Provider", "shutil"]
