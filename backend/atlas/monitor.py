"""System and model resource monitoring. Values are labelled measured vs estimated."""
from __future__ import annotations

import os
import time
from typing import Any, Dict, List

import psutil

MODEL_PROCESS_NAMES = ("ollama", "llama-server", "llama_server", "mlx_lm", "lms", "LM Studio")


def model_processes() -> List[Dict[str, Any]]:
    out = []
    for p in psutil.process_iter(["pid", "name", "cmdline", "memory_info"]):
        try:
            name = p.info["name"] or ""
            cmd = " ".join(p.info["cmdline"] or [])[:200]
            low = name.lower()
            if low == "lms" or any(n.lower() in low for n in MODEL_PROCESS_NAMES if n != "lms") or "mlx_lm.server" in cmd:
                mem = p.info.get("memory_info")  # None when macOS denies access to another user's process
                out.append({"pid": p.info["pid"], "name": name, "rss_bytes": mem.rss if mem else 0, "cmd": cmd})
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess, TypeError, AttributeError):
            continue
    return out


_self = psutil.Process(os.getpid())
_self.cpu_percent(None)
psutil.cpu_percent(None)


def snapshot() -> Dict[str, Any]:
    vm = psutil.virtual_memory()
    procs = model_processes()
    return {
        "at": time.time(),
        "cpu_percent": {"value": psutil.cpu_percent(None), "measured": True},
        "memory": {"total": vm.total, "used": vm.total - vm.available, "percent": vm.percent, "measured": True},
        "backend_process": {"rss_bytes": _self.memory_info().rss, "cpu_percent": _self.cpu_percent(None), "measured": True},
        "model_processes": procs,
        "model_process_rss_bytes": {"value": sum(p["rss_bytes"] for p in procs), "measured": True,
                                    "note": "RSS of model server processes; GPU-wired memory may be reported separately by the provider."},
    }


def hardware(path: str) -> Dict[str, Any]:
    """What this Mac can run: chip, memory and free disk space (measured)."""
    import platform
    import shutil
    import subprocess
    chip = ""
    try:
        chip = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True, timeout=2).stdout.strip()
    except Exception:  # noqa: BLE001
        pass
    try:
        free = shutil.disk_usage(path if os.path.exists(path) else os.path.expanduser("~")).free
    except OSError:
        free = 0
    return {"ram_bytes": psutil.virtual_memory().total, "chip": chip or platform.processor() or platform.machine(),
            "cores": psutil.cpu_count(logical=True), "disk_free_bytes": free}
