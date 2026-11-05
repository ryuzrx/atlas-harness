"""Test fixtures. The scripted provider below exists only in tests: it lets the orchestration
logic be exercised deterministically. Real-model tests live in tests/live/ and scripts/acceptance.py."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    d = tmp_path / "atlas-data"
    monkeypatch.setenv("ATLAS_DATA_DIR", str(d))
    return d


@pytest.fixture
def repo(tmp_path) -> Path:
    r = tmp_path / "sample"
    r.mkdir()
    (r / "calc.py").write_text("def add(a, b):\n    return a - b\n")
    (r / "README.md").write_text("# sample\n")
    for cmd in (["git", "init", "-q", "-b", "main"], ["git", "add", "-A"],
                ["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]):
        subprocess.run(cmd, cwd=r, check=True)
    return r


def script_provider_cls(script: Dict[str, List[Any]]):
    """Returns a Provider class whose replies come from `script[role_or_marker]` in order."""
    from atlas.providers.base import ChatResult, ModelInfo, Provider

    class Scripted(Provider):
        kind = "scripted"
        calls: List[Dict[str, Any]] = []

        async def health(self):
            return {"ok": True}

        async def list_models(self):
            return [ModelInfo(name="scripted", provider_id=self.id, capabilities={"tools": True})]

        def tool_support(self, model):
            return True

        async def chat(self, model, messages, *, tools=None, params=None, on_token=None, json_mode=False):
            import asyncio as _a
            await _a.sleep(0.15)
            system = messages[0]["content"]
            key = next((k for k in script if k in system), None)
            Scripted.calls.append({"key": key, "messages": messages})
            if key is None or not script[key]:
                return ChatResult(text="", tool_calls=[{"id": "f", "name": "finish", "arguments": {"summary": "nothing to do"}}])
            step = script[key].pop(0)
            if isinstance(step, str):
                return ChatResult(text=step)
            return ChatResult(text="", tool_calls=[{"id": f"c{len(Scripted.calls)}", "name": step[0], "arguments": step[1]}])

    return Scripted


def plan_json(tasks):
    return json.dumps({"summary": "test plan", "tasks": tasks})
