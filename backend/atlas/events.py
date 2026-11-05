"""Event bus: persists structured execution events and fans them out to WebSocket clients."""
from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, Optional, Set

from .db import DB, now


class EventBus:
    def __init__(self, db: DB):
        self.db = db
        self.subscribers: Set[asyncio.Queue] = set()
        self._since_prune = 0

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=2000)
        self.subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self.subscribers.discard(q)

    def broadcast(self, msg: Dict[str, Any]) -> None:
        """Push to live clients only (not persisted). Slow clients drop messages, never block agents."""
        for q in list(self.subscribers):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                pass

    def emit(self, type_: str, data: Optional[Dict[str, Any]] = None, *, task_id: Optional[str] = None,
             team_id: Optional[str] = None, agent_id: Optional[str] = None, persist: bool = True) -> Dict[str, Any]:
        data = data or {}
        encoded = json.dumps(data, default=str)
        if len(encoded) > 64_000:  # keep the event log and WebSocket frames bounded
            data = {"truncated": True, "preview": encoded[:16_000]}
        ev = {"type": type_, "data": data, "task_id": task_id, "team_id": team_id,
              "agent_id": agent_id, "at": now()}
        if persist:
            ev["id"] = self.db.x(
                "INSERT INTO events(task_id,team_id,agent_id,type,data,at) VALUES(?,?,?,?,?,?)",
                (task_id, team_id, agent_id, type_, json.dumps(data, default=str), ev["at"]),
            )
            self._since_prune += 1
            if self._since_prune > 500:
                self._since_prune = 0
                self.prune()
        self.broadcast({"kind": "event", "event": ev})
        return ev

    def changed(self, entity: str, id_: Optional[str] = None) -> None:
        """Tell the UI an entity changed so it can refetch."""
        self.broadcast({"kind": "changed", "entity": entity, "id": id_})

    def prune(self) -> None:
        keep = int(self.db.setting("storage.event_retention") or 20000)
        self.db.x("DELETE FROM events WHERE id <= (SELECT MAX(id) FROM events) - ?", (keep,))
