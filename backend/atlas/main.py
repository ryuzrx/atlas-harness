"""Backend entry point. Prints `ATLAS_READY <port>` once listening (read by the macOS shell)."""
from __future__ import annotations

import argparse
import os
import secrets
import socket
import sys
from pathlib import Path

import uvicorn

from .api import create_app


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("ATLAS_PORT", "0")))
    ap.add_argument("--static", default=os.environ.get("ATLAS_STATIC"))
    args = ap.parse_args()
    token = os.environ.get("ATLAS_TOKEN") or secrets.token_urlsafe(32)
    port = args.port or free_port()
    static = Path(args.static) if args.static else None
    app = create_app(token, static_dir=static)

    class Server(uvicorn.Server):
        def startup_hook(self):
            pass

    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", access_log=False, ws_ping_interval=20)
    server = uvicorn.Server(config)

    orig_startup = server.startup

    async def startup(sockets=None):
        await orig_startup(sockets=sockets)
        print(f"ATLAS_READY {port}", flush=True)
        if not os.environ.get("ATLAS_TOKEN"):
            print(f"ATLAS_TOKEN {token}", flush=True)

    server.startup = startup  # type: ignore[assignment]
    server.run()
    sys.exit(0)


if __name__ == "__main__":
    main()
