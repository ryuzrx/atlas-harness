"""SQLite persistence with forward-only migrations.

One connection guarded by a lock. Every statement is short, so calling from
async code is acceptable for a single-user desktop app.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from .config import DEFAULT_SETTINGS, data_dir

JSON_COLUMNS = {
    "config", "params", "tools", "deps", "acceptance", "artifacts", "evidence",
    "data", "body", "payload", "state", "value",
}

MIGRATIONS: List[str] = [
    # v1
    """
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE providers (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, base_url TEXT,
        config TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'unknown', last_error TEXT,
        created_at REAL NOT NULL, updated_at REAL NOT NULL);
    CREATE TABLE teams (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        objective TEXT NOT NULL DEFAULT '', lead_agent_id TEXT, project_id TEXT,
        config TEXT NOT NULL DEFAULT '{}', archived INTEGER NOT NULL DEFAULT 0,
        created_at REAL NOT NULL, updated_at REAL NOT NULL);
    CREATE TABLE agents (
        id TEXT PRIMARY KEY, team_id TEXT, name TEXT NOT NULL, role TEXT NOT NULL,
        instructions TEXT NOT NULL DEFAULT '', provider_id TEXT, model TEXT,
        params TEXT NOT NULL DEFAULT '{}', tools TEXT NOT NULL DEFAULT '[]',
        config TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'idle',
        created_at REAL NOT NULL, updated_at REAL NOT NULL);
    CREATE INDEX agents_team ON agents(team_id);
    CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
        workspace TEXT NOT NULL DEFAULT 'Default', config TEXT NOT NULL DEFAULT '{}',
        sort INTEGER NOT NULL DEFAULT 0, created_at REAL NOT NULL);
    CREATE TABLE tasks (
        id TEXT PRIMARY KEY, parent_id TEXT, team_id TEXT, agent_id TEXT, project_id TEXT,
        title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'code',
        priority INTEGER NOT NULL DEFAULT 2, acceptance TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL, deps TEXT NOT NULL DEFAULT '[]', result TEXT,
        artifacts TEXT NOT NULL DEFAULT '{}', evidence TEXT NOT NULL DEFAULT '{}',
        worktree TEXT, branch TEXT, base_ref TEXT, attempts INTEGER NOT NULL DEFAULT 0,
        needs_approval INTEGER NOT NULL DEFAULT 0, error TEXT,
        created_at REAL NOT NULL, updated_at REAL NOT NULL, started_at REAL, finished_at REAL);
    CREATE INDEX tasks_parent ON tasks(parent_id);
    CREATE INDEX tasks_status ON tasks(status);
    CREATE TABLE task_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, from_status TEXT,
        to_status TEXT NOT NULL, reason TEXT, at REAL NOT NULL);
    CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, team_id TEXT, agent_id TEXT,
        type TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', at REAL NOT NULL);
    CREATE INDEX events_task ON events(task_id);
    CREATE TABLE messages (
        id TEXT PRIMARY KEY, task_id TEXT, team_id TEXT, sender_agent_id TEXT,
        recipient_agent_id TEXT, type TEXT NOT NULL, body TEXT NOT NULL DEFAULT '{}', at REAL NOT NULL);
    CREATE TABLE approvals (
        id TEXT PRIMARY KEY, task_id TEXT, agent_id TEXT, kind TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending',
        created_at REAL NOT NULL, decided_at REAL);
    CREATE TABLE memory (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, scope_id TEXT NOT NULL, key TEXT NOT NULL,
        content TEXT NOT NULL, source TEXT, verified INTEGER NOT NULL DEFAULT 0,
        created_at REAL NOT NULL, updated_at REAL NOT NULL);
    CREATE INDEX memory_scope ON memory(scope, scope_id);
    CREATE TABLE checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, step INTEGER NOT NULL,
        state TEXT NOT NULL, at REAL NOT NULL);
    CREATE TABLE presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, created_at REAL NOT NULL);
    CREATE TABLE audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}', at REAL NOT NULL);
    """,
    # v2: chat-first UI — persistent conversations; per-task config (tool limits from the composer)
    """
    CREATE TABLE conversations (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}',
        created_at REAL NOT NULL, updated_at REAL NOT NULL);
    CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'done',
        task_id TEXT, data TEXT NOT NULL DEFAULT '{}', created_at REAL NOT NULL);
    CREATE INDEX chat_messages_conv ON chat_messages(conversation_id, created_at);
    ALTER TABLE tasks ADD COLUMN config TEXT NOT NULL DEFAULT '{}';
    """,
]


def new_id(prefix: str = "") -> str:
    return (prefix + "_" if prefix else "") + uuid.uuid4().hex[:12]


def now() -> float:
    return time.time()


class DB:
    def __init__(self, path: Optional[Path] = None):
        self.path = path or (data_dir() / "atlas.db")
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(str(self.path), check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.execute("PRAGMA busy_timeout=5000")
        self.migrate()

    # ---- schema
    def migrate(self) -> None:
        with self.lock:
            version = self.conn.execute("PRAGMA user_version").fetchone()[0]
            for i, sql in enumerate(MIGRATIONS[version:], start=version + 1):
                self.conn.execute("BEGIN")
                try:
                    for stmt in _split_sql(sql):
                        self.conn.execute(stmt)
                    self.conn.execute(f"PRAGMA user_version={i}")
                    self.conn.execute("COMMIT")
                except Exception:
                    self.conn.execute("ROLLBACK")
                    raise

    @property
    def schema_version(self) -> int:
        return self.conn.execute("PRAGMA user_version").fetchone()[0]

    # ---- generic helpers
    @staticmethod
    def _decode(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
        if row is None:
            return None
        d = dict(row)
        for k, v in d.items():
            if k in JSON_COLUMNS and isinstance(v, str):
                try:
                    d[k] = json.loads(v)
                except ValueError:
                    pass
        return d

    @staticmethod
    def _encode(values: Dict[str, Any]) -> Dict[str, Any]:
        out = {}
        for k, v in values.items():
            if k in JSON_COLUMNS and not isinstance(v, str):
                v = json.dumps(v)
            elif isinstance(v, bool):
                v = int(v)
            out[k] = v
        return out

    def q(self, sql: str, args: Iterable[Any] = ()) -> List[Dict[str, Any]]:
        with self.lock:
            return [self._decode(r) for r in self.conn.execute(sql, tuple(args)).fetchall()]

    def one(self, sql: str, args: Iterable[Any] = ()) -> Optional[Dict[str, Any]]:
        with self.lock:
            return self._decode(self.conn.execute(sql, tuple(args)).fetchone())

    def x(self, sql: str, args: Iterable[Any] = ()) -> int:
        with self.lock:
            cur = self.conn.execute(sql, tuple(args))
            return cur.lastrowid

    def insert(self, table: str, values: Dict[str, Any]) -> Dict[str, Any]:
        v = self._encode(values)
        cols = ",".join(v.keys())
        ph = ",".join("?" for _ in v)
        with self.lock:
            rid = self.conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({ph})", tuple(v.values())).lastrowid
        key = values.get("id", rid)
        return self.get(table, key)

    def update(self, table: str, id_: Any, values: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not values:
            return self.get(table, id_)
        v = self._encode(values)
        sets = ",".join(f"{k}=?" for k in v)
        with self.lock:
            self.conn.execute(f"UPDATE {table} SET {sets} WHERE id=?", (*v.values(), id_))
        return self.get(table, id_)

    def get(self, table: str, id_: Any) -> Optional[Dict[str, Any]]:
        return self.one(f"SELECT * FROM {table} WHERE id=?", (id_,))

    def delete(self, table: str, id_: Any) -> None:
        self.x(f"DELETE FROM {table} WHERE id=?", (id_,))

    # ---- settings
    def settings(self) -> Dict[str, Any]:
        s = dict(DEFAULT_SETTINGS)
        for r in self.conn.execute("SELECT key, value FROM settings").fetchall():
            s[r["key"]] = json.loads(r["value"])
        return s

    def setting(self, key: str) -> Any:
        r = self.conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return json.loads(r["value"]) if r else DEFAULT_SETTINGS.get(key)

    def set_setting(self, key: str, value: Any) -> None:
        with self.lock:
            self.conn.execute(
                "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, json.dumps(value)),
            )

    def audit(self, actor: str, action: str, data: Dict[str, Any]) -> None:
        self.x("INSERT INTO audit(actor,action,data,at) VALUES(?,?,?,?)", (actor, action, json.dumps(data), now()))


def _split_sql(script: str) -> List[str]:
    return [s.strip() for s in script.split(";") if s.strip()]
