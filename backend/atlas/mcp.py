"""Minimal Model Context Protocol client (stdio transport, JSON-RPC 2.0).

Servers are configured by the user in Settings > Integrations as
{"name": "fs", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"], "enabled": true}.
Servers start lazily on first use and every call requires approval through the agent tool policy.
"""
from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Dict, List, Optional

from .providers.cli_agents import cli_env, find_binary

PROTOCOL_VERSION = "2025-06-18"


class MCPServer:
    def __init__(self, cfg: Dict[str, Any]):
        self.cfg = cfg
        self.name = cfg["name"]
        self.proc: Optional[asyncio.subprocess.Process] = None
        self.next_id = 0
        self.pending: Dict[int, asyncio.Future] = {}
        self.tools: List[Dict[str, Any]] = []
        self.reader: Optional[asyncio.Task] = None
        self.lock = asyncio.Lock()
        self.error: Optional[str] = None

    async def start(self) -> None:
        if self.proc and self.proc.returncode is None:
            return
        cmd = find_binary(self.cfg["command"]) or self.cfg["command"]
        env = cli_env(cmd)
        env.update(self.cfg.get("env") or {})
        self.proc = await asyncio.create_subprocess_exec(
            cmd, *(self.cfg.get("args") or []), stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL, env=env, limit=16 * 1024 * 1024)
        self.reader = asyncio.ensure_future(self._read())
        await self.request("initialize", {"protocolVersion": PROTOCOL_VERSION, "capabilities": {},
                                          "clientInfo": {"name": "atlas-harness", "version": "0.1.0"}})
        await self.notify("notifications/initialized", {})
        res = await self.request("tools/list", {})
        self.tools = res.get("tools", [])

    async def _read(self) -> None:
        assert self.proc and self.proc.stdout
        async for raw in self.proc.stdout:
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            fut = self.pending.pop(msg.get("id"), None) if "id" in msg else None
            if fut and not fut.done():
                if "error" in msg:
                    fut.set_exception(RuntimeError(f"MCP {self.name}: {msg['error'].get('message')}"))
                else:
                    fut.set_result(msg.get("result") or {})
        for fut in self.pending.values():
            if not fut.done():
                fut.set_exception(RuntimeError(f"MCP server '{self.name}' exited"))

    async def _send(self, payload: Dict[str, Any]) -> None:
        assert self.proc and self.proc.stdin
        self.proc.stdin.write((json.dumps(payload) + "\n").encode())
        await self.proc.stdin.drain()

    async def request(self, method: str, params: Dict[str, Any], timeout: float = 60) -> Dict[str, Any]:
        self.next_id += 1
        rid = self.next_id
        fut = asyncio.get_running_loop().create_future()
        self.pending[rid] = fut
        await self._send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
        return await asyncio.wait_for(fut, timeout)

    async def notify(self, method: str, params: Dict[str, Any]) -> None:
        await self._send({"jsonrpc": "2.0", "method": method, "params": params})

    async def call(self, tool: str, args: Dict[str, Any]) -> str:
        res = await self.request("tools/call", {"name": tool, "arguments": args}, timeout=300)
        parts = []
        for c in res.get("content") or []:
            parts.append(c.get("text") if c.get("type") == "text" else json.dumps(c)[:2000])
        out = "\n".join(p for p in parts if p)
        return ("ERROR: " if res.get("isError") else "") + out

    async def stop(self) -> None:
        if self.proc and self.proc.returncode is None:
            self.proc.terminate()
            try:
                await asyncio.wait_for(self.proc.wait(), 3)
            except asyncio.TimeoutError:
                self.proc.kill()


class MCPManager:
    def __init__(self):
        self.servers: Dict[str, MCPServer] = {}

    def configure(self, configs: List[Dict[str, Any]]) -> None:
        wanted = {c["name"]: c for c in configs if c.get("enabled", True) and c.get("name") and c.get("command")}
        for name in list(self.servers):
            if name not in wanted or self.servers[name].cfg != wanted[name]:
                asyncio.ensure_future(self.servers.pop(name).stop())
        for name, cfg in wanted.items():
            self.servers.setdefault(name, MCPServer(cfg))

    @property
    def enabled(self) -> bool:
        return bool(self.servers)

    async def list_tools(self) -> List[Dict[str, Any]]:
        out = []
        for s in self.servers.values():
            async with s.lock:
                try:
                    await s.start()
                    s.error = None
                except Exception as e:  # noqa: BLE001
                    s.error = str(e)
                    continue
            for t in s.tools:
                out.append({"name": f"{s.name}/{t['name']}", "description": t.get("description", ""),
                            "input_schema": t.get("inputSchema")})
        return out

    async def call(self, qualified: str, args: Dict[str, Any]) -> str:
        server, _, tool = qualified.partition("/")
        s = self.servers.get(server)
        if not s:
            raise RuntimeError(f"Unknown MCP server '{server}'")
        async with s.lock:
            await s.start()
        return await s.call(tool, args)

    def status(self) -> List[Dict[str, Any]]:
        return [{"name": s.name, "running": bool(s.proc and s.proc.returncode is None), "tools": len(s.tools),
                 "error": s.error} for s in self.servers.values()]

    async def shutdown(self) -> None:
        await asyncio.gather(*(s.stop() for s in self.servers.values()), return_exceptions=True)


_ = os
