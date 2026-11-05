"""Anthropic Messages API (Claude models via API key)."""
from __future__ import annotations

import json
import time
from typing import Any, Dict, List, Optional

import httpx

from .base import ChatResult, ModelInfo, Provider, ProviderError, TokenCallback, parse_args

API_VERSION = "2023-06-01"


class AnthropicProvider(Provider):
    kind = "anthropic"

    @property
    def api_base(self) -> str:
        return self.base_url or "https://api.anthropic.com"

    def headers(self) -> Dict[str, str]:
        if not self.secret:
            raise ProviderError("No Anthropic API key configured for this provider.", retryable=False)
        return {"x-api-key": self.secret, "anthropic-version": API_VERSION, "content-type": "application/json"}

    async def health(self) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=8) as c:
                r = await c.get(self.api_base + "/v1/models", headers=self.headers())
                if r.status_code == 401:
                    return {"ok": False, "error": "Unauthorized: check the Anthropic API key."}
                r.raise_for_status()
                return {"ok": True}
        except ProviderError as e:
            return {"ok": False, "error": str(e)}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": f"Anthropic API not reachable: {e.__class__.__name__}"}

    async def list_models(self) -> List[ModelInfo]:
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.get(self.api_base + "/v1/models", params={"limit": 100}, headers=self.headers())
                r.raise_for_status()
                data = r.json().get("data", [])
        except ProviderError:
            raise
        except Exception as e:  # noqa: BLE001
            raise ProviderError(f"Cannot list Anthropic models: {e}") from e
        # Tool use and streaming are documented features of the Messages API for listed models.
        return [ModelInfo(name=m["id"], provider_id=self.id, capabilities={"tools": True, "streaming": True, "structured": True},
                          details={"display_name": m.get("display_name"), "created_at": m.get("created_at")}, state="available")
                for m in data]

    def tool_support(self, model: str) -> Optional[bool]:
        return True

    async def chat(self, model, messages, *, tools=None, params=None, on_token: TokenCallback = None, json_mode=False):
        params = params or {}
        system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
        conv = _to_anthropic([m for m in messages if m["role"] != "system"])
        body: Dict[str, Any] = {"model": model, "max_tokens": int(params.get("max_tokens") or 8192),
                                "messages": conv, "stream": True}
        if system:
            body["system"] = system
        if params.get("temperature") is not None:
            body["temperature"] = params["temperature"]
        if tools:
            body["tools"] = [{"name": t["name"], "description": t["description"], "input_schema": t["parameters"]} for t in tools]
        result = ChatResult()
        blocks: Dict[int, Dict[str, Any]] = {}
        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=600.0)) as c:
                async with c.stream("POST", self.api_base + "/v1/messages", json=body, headers=self.headers()) as r:
                    if r.status_code >= 400:
                        detail = (await r.aread()).decode(errors="replace")[:600]
                        raise ProviderError(f"Anthropic HTTP {r.status_code}: {detail}",
                                            retryable=r.status_code in (429, 500, 502, 503, 529))
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        ev = json.loads(line[5:].strip())
                        t = ev.get("type")
                        if t == "content_block_start":
                            cb = ev["content_block"]
                            blocks[ev["index"]] = {"type": cb["type"], "id": cb.get("id"), "name": cb.get("name"), "json": ""}
                        elif t == "content_block_delta":
                            d = ev["delta"]
                            if d.get("type") == "text_delta":
                                result.text += d["text"]
                                if on_token:
                                    await on_token(d["text"])
                            elif d.get("type") == "input_json_delta":
                                blocks[ev["index"]]["json"] += d.get("partial_json", "")
                        elif t == "message_start":
                            result.usage.update((ev.get("message") or {}).get("usage") or {})
                        elif t == "message_delta":
                            result.usage.update(ev.get("usage") or {})
                        elif t == "error":
                            raise ProviderError(f"Anthropic stream error: {ev.get('error')}")
        except httpx.HTTPError as e:
            raise ProviderError(f"Anthropic connection failed: {e.__class__.__name__}: {e}") from e
        for i in sorted(blocks):
            b = blocks[i]
            if b["type"] == "tool_use":
                result.tool_calls.append({"id": b["id"], "name": b["name"], "arguments": parse_args(b["json"] or "{}")})
        result.usage["measured"] = True
        result.latency_ms = (time.perf_counter() - t0) * 1000
        return result


def _to_anthropic(msgs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for m in msgs:
        if m["role"] == "tool":
            block = {"type": "tool_result", "tool_use_id": m.get("tool_call_id", ""), "content": m.get("content") or ""}
            if out and out[-1]["role"] == "user" and isinstance(out[-1]["content"], list):
                out[-1]["content"].append(block)
            else:
                out.append({"role": "user", "content": [block]})
            continue
        if m["role"] == "assistant":
            content: List[Dict[str, Any]] = []
            if m.get("content"):
                content.append({"type": "text", "text": m["content"]})
            for tc in m.get("tool_calls") or []:
                content.append({"type": "tool_use", "id": tc["id"], "name": tc["name"], "input": tc["arguments"]})
            out.append({"role": "assistant", "content": content or [{"type": "text", "text": "(no output)"}]})
            continue
        if isinstance(m.get("content"), list):
            content = []
            for block in m["content"]:
                if block.get("type") == "image":
                    content.append({"type": "image", "source": {"type": "base64", "media_type": block.get("mime_type") or "image/png", "data": block.get("data", "")}})
                elif block.get("type") == "text":
                    content.append({"type": "text", "text": block.get("text", "")})
            out.append({"role": "user", "content": content})
            continue
        if out and out[-1]["role"] == "user":
            prev = out[-1]["content"]
            if isinstance(prev, str):
                out[-1]["content"] = [{"type": "text", "text": prev}]
            out[-1]["content"].append({"type": "text", "text": m.get("content") or ""})
        else:
            out.append({"role": "user", "content": m.get("content") or ""})
    return out
