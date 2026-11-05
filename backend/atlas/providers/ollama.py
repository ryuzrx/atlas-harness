"""Ollama provider (local models, including abliterated/uncensored community builds)."""
from __future__ import annotations

import json
import time
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx

from .base import ChatResult, ModelInfo, Provider, ProviderError, TokenCallback, parse_args


class OllamaProvider(Provider):
    kind = "ollama"

    def __init__(self, row, secret=None):
        super().__init__(row, secret)
        self.base_url = self.base_url or "http://127.0.0.1:11434"
        self._show_cache: Dict[str, Dict[str, Any]] = {}

    def _client(self, timeout: float = 10.0) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self.base_url, timeout=httpx.Timeout(timeout, read=None if timeout > 60 else timeout))

    async def health(self) -> Dict[str, Any]:
        try:
            async with self._client(3) as c:
                r = await c.get("/api/version")
                r.raise_for_status()
                return {"ok": True, "version": r.json().get("version")}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": f"Ollama not reachable at {self.base_url}: {e.__class__.__name__}"}

    async def show(self, model: str) -> Dict[str, Any]:
        if model in self._show_cache:
            return self._show_cache[model]
        async with self._client(15) as c:
            r = await c.post("/api/show", json={"model": model})
            r.raise_for_status()
            data = r.json()
        self._show_cache[model] = data
        return data

    async def loaded(self) -> List[Dict[str, Any]]:
        try:
            async with self._client(3) as c:
                r = await c.get("/api/ps")
                r.raise_for_status()
                return r.json().get("models", [])
        except Exception:  # noqa: BLE001
            return []

    async def list_models(self) -> List[ModelInfo]:
        try:
            async with self._client(5) as c:
                r = await c.get("/api/tags")
                r.raise_for_status()
                tags = r.json().get("models", [])
        except Exception as e:  # noqa: BLE001
            raise ProviderError(f"Cannot list Ollama models: {e}") from e
        loaded = {m["name"]: m for m in await self.loaded()}
        out = []
        for m in tags:
            name = m["name"]
            caps: Dict[str, Optional[bool]] = {"streaming": True, "tools": None, "structured": True, "vision": None}
            ctx = None
            details = dict(m.get("details") or {})
            try:
                info = await self.show(name)
                cap_list = info.get("capabilities")
                if isinstance(cap_list, list):  # reported by Ollama from the model template, not guessed from the name
                    caps["tools"] = "tools" in cap_list
                    caps["vision"] = "vision" in cap_list
                    caps["thinking"] = "thinking" in cap_list
                for k, v in (info.get("model_info") or {}).items():
                    if k.endswith(".context_length"):
                        ctx = int(v)
            except Exception:  # noqa: BLE001
                pass
            probed = (self.config.get("model_caps") or {}).get(name) or {}
            for k in ("tools", "structured"):
                if k in probed:
                    caps[k] = probed[k]
            if probed:
                caps["probed"] = True
            state = "installed"
            if name in loaded:
                state = "processing" if self.active_requests else "loaded"
                details["vram_bytes"] = loaded[name].get("size_vram")
                details["loaded_size_bytes"] = loaded[name].get("size")
                details["expires_at"] = loaded[name].get("expires_at")
            out.append(ModelInfo(name=name, provider_id=self.id, size_bytes=m.get("size"), context_length=ctx,
                                 capabilities=caps, details=details, state=state))
        return out

    def tool_support(self, model: str) -> Optional[bool]:
        override = self.config.get("tool_mode")
        if override in ("native", "text"):
            return override == "native"
        probed = (self.config.get("model_caps") or {}).get(model) or {}
        if "tools" in probed:  # a real probe beats the template's claim
            return probed["tools"]
        cached = self._show_cache.get(model)
        if cached and isinstance(cached.get("capabilities"), list):
            return "tools" in cached["capabilities"]
        return super().tool_support(model)

    async def ensure_caps(self, model: str) -> None:
        try:
            await self.show(model)
        except Exception:  # noqa: BLE001
            pass

    async def chat(self, model, messages, *, tools=None, params=None, on_token: TokenCallback = None, json_mode=False):
        params = params or {}
        opts = {}
        if "temperature" in params:
            opts["temperature"] = params["temperature"]
        if params.get("num_ctx"):
            opts["num_ctx"] = int(params["num_ctx"])
        if params.get("top_p") is not None:
            opts["top_p"] = params["top_p"]
        body: Dict[str, Any] = {"model": model, "messages": [_to_ollama(m) for m in messages], "stream": True,
                                "options": opts, "keep_alive": params.get("keep_alive", "10m")}
        if tools:
            body["tools"] = [{"type": "function", "function": {"name": t["name"], "description": t["description"],
                                                                "parameters": t["parameters"]}} for t in tools]
        if json_mode:
            body["format"] = "json"
        result = ChatResult()
        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(base_url=self.base_url, timeout=httpx.Timeout(30.0, read=600.0)) as c:
                async with c.stream("POST", "/api/chat", json=body) as r:
                    if r.status_code >= 400:
                        detail = (await r.aread()).decode(errors="replace")[:500]
                        raise ProviderError(f"Ollama HTTP {r.status_code}: {detail}", retryable=r.status_code >= 500)
                    async for line in r.aiter_lines():
                        if not line.strip():
                            continue
                        chunk = json.loads(line)
                        if chunk.get("error"):
                            raise ProviderError(f"Ollama: {chunk['error']}")
                        msg = chunk.get("message") or {}
                        piece = msg.get("content") or ""
                        if piece:
                            result.text += piece
                            if on_token:
                                await on_token(piece)
                        for i, tc in enumerate(msg.get("tool_calls") or []):
                            fn = tc.get("function") or {}
                            result.tool_calls.append({"id": f"call_{len(result.tool_calls)}_{i}",
                                                      "name": fn.get("name", ""), "arguments": parse_args(fn.get("arguments"))})
                        if chunk.get("done"):
                            result.usage = {"prompt_tokens": chunk.get("prompt_eval_count"),
                                            "completion_tokens": chunk.get("eval_count"),
                                            "load_ms": (chunk.get("load_duration") or 0) / 1e6,
                                            "measured": True}
        except httpx.HTTPError as e:
            raise ProviderError(f"Ollama connection failed: {e.__class__.__name__}: {e}") from e
        result.latency_ms = (time.perf_counter() - t0) * 1000
        return result

    async def pull(self, model: str) -> AsyncIterator[Dict[str, Any]]:
        try:
            async with httpx.AsyncClient(base_url=self.base_url, timeout=httpx.Timeout(30.0, read=None)) as c:
                async with c.stream("POST", "/api/pull", json={"model": model, "stream": True}) as r:
                    if r.status_code >= 400:
                        detail = (await r.aread()).decode(errors="replace")[:500]
                        raise ProviderError(f"Ollama HTTP {r.status_code} while downloading {model}: {detail}",
                                            retryable=r.status_code >= 500)
                    async for line in r.aiter_lines():
                        if not line.strip():
                            continue
                        event = json.loads(line)
                        if event.get("error"):
                            detail = str(event["error"])
                            if "all connection attempts failed" in detail.lower():
                                detail = ("Ollama could not connect to its model registry while downloading "
                                          f"{model}. Check that this Mac can reach the internet and that any "
                                          f"VPN or proxy allows Ollama to access registry.ollama.ai. Original error: {event['error']}")
                            raise ProviderError(f"Ollama download failed: {detail}")
                        yield event
        except httpx.HTTPError as e:
            raise ProviderError(f"Cannot reach Ollama at {self.base_url} to download {model}: {e}") from e
        self._show_cache.pop(model, None)

    async def delete_model(self, model: str) -> None:
        async with self._client(30) as c:
            r = await c.request("DELETE", "/api/delete", json={"model": model})
            r.raise_for_status()
        self._show_cache.pop(model, None)

    async def unload(self, model: str) -> None:
        async with self._client(30) as c:
            await c.post("/api/generate", json={"model": model, "keep_alive": 0})


def _to_ollama(m: Dict[str, Any]) -> Dict[str, Any]:
    content = m.get("content") or ""
    images = []
    if isinstance(content, list):
        text = []
        for block in content:
            if block.get("type") == "image":
                images.append(block.get("data", ""))
            elif block.get("type") == "text":
                text.append(block.get("text", ""))
        content = "\n".join(text)
    out: Dict[str, Any] = {"role": m["role"], "content": content}
    if images:
        out["images"] = images
    if m.get("tool_calls"):
        out["tool_calls"] = [{"function": {"name": tc["name"], "arguments": tc["arguments"]}} for tc in m["tool_calls"]]
    if m["role"] == "tool" and m.get("name"):
        out["tool_name"] = m["name"]
    return out
