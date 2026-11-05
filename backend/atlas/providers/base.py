"""Provider interface. Messages use an OpenAI-like neutral shape:

{"role": "system"|"user"|"assistant"|"tool", "content": str,
 "tool_calls": [{"id": str, "name": str, "arguments": dict}],   # assistant only
 "tool_call_id": str, "name": str}                             # tool only
"""
from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional

TokenCallback = Optional[Callable[[str], Awaitable[None]]]


class ProviderError(Exception):
    def __init__(self, message: str, *, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


@dataclass
class ChatResult:
    text: str = ""
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    usage: Dict[str, Any] = field(default_factory=dict)
    latency_ms: float = 0.0


@dataclass
class ModelInfo:
    name: str
    provider_id: str
    size_bytes: Optional[int] = None
    context_length: Optional[int] = None
    capabilities: Dict[str, Optional[bool]] = field(default_factory=dict)  # tools/streaming/structured/vision; None = unverified
    details: Dict[str, Any] = field(default_factory=dict)
    state: str = "available"  # installed | available | loaded | processing | unavailable | failed

    def to_dict(self) -> Dict[str, Any]:
        return self.__dict__.copy()


class Provider:
    kind = "base"
    agentic = False  # True for CLI agents that run their own tool loop (Claude Code, Codex)

    def __init__(self, row: Dict[str, Any], secret: Optional[str] = None):
        self.row = row
        self.id = row["id"]
        self.name = row["name"]
        self.base_url = (row.get("base_url") or "").rstrip("/")
        self.config: Dict[str, Any] = row.get("config") or {}
        self.secret = secret
        self.active_requests = 0
        self.total_requests = 0
        self.errors = 0
        self.last_latency_ms: Optional[float] = None

    async def health(self) -> Dict[str, Any]:
        raise NotImplementedError

    async def list_models(self) -> List[ModelInfo]:
        raise NotImplementedError

    async def chat(self, model: str, messages: List[Dict[str, Any]], *, tools: Optional[List[Dict[str, Any]]] = None,
                   params: Optional[Dict[str, Any]] = None, on_token: TokenCallback = None,
                   json_mode: bool = False) -> ChatResult:
        raise NotImplementedError

    def tool_support(self, model: str) -> Optional[bool]:
        """Verified tool-calling support for `model` (None when not yet probed)."""
        caps = (self.config.get("model_caps") or {}).get(model) or {}
        override = self.config.get("tool_mode")  # 'native' | 'text' | None
        if override == "native":
            return True
        if override == "text":
            return False
        return caps.get("tools")

    def stats(self) -> Dict[str, Any]:
        return {"active_requests": self.active_requests, "total_requests": self.total_requests,
                "errors": self.errors, "last_latency_ms": self.last_latency_ms}


def tool_schema_openai(tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [{"type": "function", "function": {"name": t["name"], "description": t["description"],
                                                 "parameters": t["parameters"]}} for t in tools]


def parse_args(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if not raw:
        return {}
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else {"value": v}
    except ValueError:
        return {"_raw": raw}


class Timer:
    def __enter__(self):
        self.t0 = time.perf_counter()
        return self

    def __exit__(self, *a):
        self.ms = (time.perf_counter() - self.t0) * 1000


async def cancellable_sleep(s: float) -> None:
    await asyncio.sleep(s)
