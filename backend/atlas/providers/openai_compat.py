"""OpenAI-compatible chat completions: MLX-LM server, llama.cpp server, LM Studio, vLLM,
OpenRouter, and the OpenAI API itself (including Codex-family models)."""
from __future__ import annotations

import json
import time
from typing import Any, Dict, List, Optional

from urllib.parse import urlsplit

import httpx

from .base import ChatResult, ModelInfo, Provider, ProviderError, TokenCallback, parse_args, tool_schema_openai


class OpenAICompatProvider(Provider):
    kind = "openai_compat"

    def headers(self) -> Dict[str, str]:
        h = {"Content-Type": "application/json"}
        for k, v in (self.config.get("headers") or {}).items():  # e.g. OpenRouter attribution headers
            if isinstance(k, str) and isinstance(v, str) and k.lower() != "authorization":
                h[k] = v
        if self.secret:
            h["Authorization"] = f"Bearer {self.secret}"
        return h

    @property
    def api_base(self) -> str:
        """Use the URL as given when it has a path (Gemini /v1beta/openai, DeepInfra /v1/openai,
        Z.ai /api/paas/v4 ...); a bare host such as http://127.0.0.1:8080 gets the conventional /v1."""
        b = (self.base_url or "https://api.openai.com/v1").rstrip("/")
        if self.config.get("exact_base_url") or urlsplit(b).path not in ("", "/"):
            return b
        return b + "/v1"

    async def health(self) -> Dict[str, Any]:
        if self.config.get("no_model_list"):  # nothing cheap to probe; a real request verifies the key
            return {"ok": True, "note": "Model list is fixed for this provider; send a message to verify the key."}
        try:
            async with httpx.AsyncClient(timeout=8) as c:
                check = self.config.get("auth_check_path")  # e.g. OpenRouter's /key validates the key itself
                if check and self.secret:
                    k = await c.get(self.api_base + check, headers=self.headers())
                    if k.status_code in (401, 403):
                        return {"ok": False, "error": "Unauthorized: check the API key."}
                r = await c.get(self.api_base + "/models", headers=self.headers())
                if r.status_code == 401:
                    return {"ok": False, "error": "Unauthorized: check the API key."}
                r.raise_for_status()
                return {"ok": True}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": f"{self.api_base} not reachable: {e.__class__.__name__}"}

    async def list_models(self) -> List[ModelInfo]:
        if self.config.get("no_model_list"):
            caps_store = self.config.get("model_caps") or {}
            return [ModelInfo(name=m, provider_id=self.id, capabilities=caps_store.get(m, {}), state="available")
                    for m in self.config.get("extra_models") or []]
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.get(self.api_base + "/models", headers=self.headers())
                r.raise_for_status()
                data = r.json().get("data", [])
        except Exception as e:  # noqa: BLE001
            raise ProviderError(f"Cannot list models from {self.api_base}: {e}") from e
        caps_store = self.config.get("model_caps") or {}
        out = []
        prefix = self.config.get("strip_model_prefix")
        for m in data:
            mid = m.get("id")
            if not mid:
                continue
            if prefix and mid.startswith(prefix):
                mid = mid[len(prefix):]
            caps = {"streaming": None, "tools": None, "structured": None}
            caps.update(caps_store.get(mid, {}))
            ctx = m.get("context_length") or m.get("max_model_len") or (caps_store.get(mid, {}).get("context_length"))
            out.append(ModelInfo(name=mid, provider_id=self.id, context_length=ctx, capabilities=caps,
                                 details={"owned_by": m.get("owned_by")}, state="available"))
        for extra in self.config.get("extra_models") or []:
            if not any(x.name == extra for x in out):
                out.append(ModelInfo(name=extra, provider_id=self.id, capabilities=caps_store.get(extra, {}), state="available"))
        out.sort(key=lambda x: x.name or "")
        return out

    async def chat(self, model, messages, *, tools=None, params=None, on_token: TokenCallback = None, json_mode=False):
        params = params or {}
        body: Dict[str, Any] = {"model": model, "messages": [_to_openai(m) for m in messages], "stream": True}
        if params.get("temperature") is not None and not self.config.get("omit_temperature"):
            body["temperature"] = params["temperature"]
        if params.get("max_tokens"):
            body["max_tokens"] = int(params["max_tokens"])
        if tools:
            body["tools"] = tool_schema_openai(tools)
        if json_mode and self.config.get("json_mode", True):
            body["response_format"] = {"type": "json_object"}
        result = ChatResult()
        partial: Dict[int, Dict[str, Any]] = {}
        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=600.0)) as c:
                async with c.stream("POST", self.api_base + "/chat/completions", json=body, headers=self.headers()) as r:
                    if r.status_code >= 400:
                        detail = (await r.aread()).decode(errors="replace")[:600]
                        raise ProviderError(f"HTTP {r.status_code} from {self.name}: {detail}",
                                            retryable=r.status_code >= 500 or r.status_code == 429)
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if payload == "[DONE]":
                            break
                        chunk = json.loads(payload)
                        if chunk.get("usage"):
                            result.usage = {**chunk["usage"], "measured": True}
                        for choice in chunk.get("choices") or []:
                            delta = choice.get("delta") or {}
                            piece = delta.get("content")
                            if piece:
                                result.text += piece
                                if on_token:
                                    await on_token(piece)
                            for tc in delta.get("tool_calls") or []:
                                slot = partial.setdefault(tc.get("index", 0), {"id": "", "name": "", "args": ""})
                                slot["id"] = tc.get("id") or slot["id"]
                                fn = tc.get("function") or {}
                                slot["name"] += fn.get("name") or ""
                                slot["args"] += fn.get("arguments") or ""
        except httpx.HTTPError as e:
            raise ProviderError(f"{self.name} connection failed: {e.__class__.__name__}: {e}") from e
        for i in sorted(partial):
            s = partial[i]
            result.tool_calls.append({"id": s["id"] or f"call_{i}", "name": s["name"], "arguments": parse_args(s["args"])})
        result.latency_ms = (time.perf_counter() - t0) * 1000
        return result


def _to_openai(m: Dict[str, Any]) -> Dict[str, Any]:
    if m["role"] == "tool":
        return {"role": "tool", "tool_call_id": m.get("tool_call_id", ""), "content": m.get("content") or ""}
    content = m.get("content") or ""
    if isinstance(content, list):
        parts = []
        for block in content:
            if block.get("type") == "image":
                mime = block.get("mime_type") or "image/png"
                parts.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{block.get('data', '')}"}})
            elif block.get("type") == "text":
                parts.append({"type": "text", "text": block.get("text", "")})
        content = parts
    out: Dict[str, Any] = {"role": m["role"], "content": content}
    if m.get("tool_calls"):
        out["tool_calls"] = [{"id": tc["id"], "type": "function",
                              "function": {"name": tc["name"], "arguments": json.dumps(tc["arguments"])}}
                             for tc in m["tool_calls"]]
        if not out["content"]:
            out["content"] = None
    return out
