"""One-shot broker between Atlas model tasks and the trusted macOS UI bridge."""
from __future__ import annotations

import asyncio
import time
from collections import deque
from dataclasses import dataclass
from typing import Any, Deque, Dict, Optional


@dataclass
class PendingRequest:
    id: str
    task_id: str
    action: Dict[str, Any]
    future: asyncio.Future
    created: float
    delivered: bool = False


class ComputerUseError(RuntimeError):
    pass


class ComputerUseBroker:
    """Token-authenticated API handlers share this broker with the in-process task runner."""

    def __init__(self) -> None:
        self.pending: Dict[str, PendingRequest] = {}
        self.queue: Deque[str] = deque()
        self.changed = asyncio.Event()

    async def request(self, task_id: str, action: Dict[str, Any]) -> Dict[str, Any]:
        loop = asyncio.get_running_loop()
        rid = f"cu_{time.time_ns():x}"
        item = PendingRequest(rid, task_id, dict(action), loop.create_future(), time.monotonic())
        self.pending[rid] = item
        self.queue.append(rid)
        self.changed.set()
        try:
            return await asyncio.wait_for(item.future, timeout=120)
        except asyncio.TimeoutError as exc:
            raise ComputerUseError("Atlas Computer Use timed out. Try the action again.") from exc
        finally:
            self.pending.pop(rid, None)

    async def next_request(self, timeout: float = 0.75) -> Optional[Dict[str, Any]]:
        deadline = time.monotonic() + timeout
        while True:
            while self.queue:
                rid = self.queue.popleft()
                item = self.pending.get(rid)
                if not item or item.future.done() or item.delivered:
                    continue
                item.delivered = True
                return {"id": item.id, "task_id": item.task_id, "action": item.action}
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            self.changed.clear()
            try:
                await asyncio.wait_for(self.changed.wait(), remaining)
            except asyncio.TimeoutError:
                return None

    def respond(self, request_id: str, result: Dict[str, Any]) -> None:
        item = self.pending.get(request_id)
        if not item or item.future.done():
            raise ComputerUseError("This computer action has expired or was stopped.")
        if not isinstance(result, dict):
            raise ComputerUseError("Invalid native computer-use response.")
        if result.get("error"):
            item.future.set_exception(ComputerUseError(str(result["error"])[:500]))
            return
        image = result.get("image")
        if image is not None:
            if not isinstance(image, dict) or image.get("mime_type") not in ("image/jpeg", "image/png"):
                raise ComputerUseError("The native bridge returned an unsupported image.")
            data = image.get("data")
            if not isinstance(data, str) or len(data) > 8_000_000:
                raise ComputerUseError("The screen capture is too large to send.")
        item.future.set_result(result)

    def is_active(self, request_id: str) -> bool:
        item = self.pending.get(request_id)
        return bool(item and not item.future.done())

    def cancel_task(self, task_id: str) -> None:
        for item in list(self.pending.values()):
            if item.task_id == task_id and not item.future.done():
                item.future.cancel()
                self.pending.pop(item.id, None)
        self.changed.set()

