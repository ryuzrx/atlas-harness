"""CLI model catalogs expose only selectable model metadata."""
import asyncio
import json

import pytest

from atlas.providers.cli_agents import ClaudeCodeProvider, CodexProvider


def provider(cls, config=None):
    return cls({"id": "demo", "name": "Demo", "enabled": 1, "config": config or {}})


def test_codex_catalog_hides_internal_entries_and_private_fields(tmp_path, monkeypatch):
    monkeypatch.setenv("CODEX_HOME", str(tmp_path))
    (tmp_path / "models_cache.json").write_text(json.dumps({
        "identity": "private-account", "models": [
            {"slug": "coding-model", "display_name": "Coding model", "description": "Code and review", "visibility": "list", "context_window": 64000, "input_modalities": ["text", "image"], "model_messages": "private-instructions"},
            {"slug": "internal-model", "visibility": "hide"},
        ],
    }))
    models = asyncio.run(provider(CodexProvider).list_models())
    assert [m.name for m in models] == ["default", "coding-model"]
    assert models[1].details["display_name"] == "Coding model"
    assert models[1].context_length == 64000
    assert models[1].capabilities["vision"] is True
    serialized = json.dumps([m.to_dict() for m in models])
    assert "private-account" not in serialized
    assert "private-instructions" not in serialized
    assert "internal-model" not in serialized


@pytest.mark.parametrize("contents", [None, "broken json", '{"models": null}', '{"models": [null]}'])
def test_codex_missing_or_invalid_cache_keeps_default_and_custom_models(tmp_path, monkeypatch, contents):
    monkeypatch.setenv("CODEX_HOME", str(tmp_path))
    if contents is not None:
        (tmp_path / "models_cache.json").write_text(contents)
    models = asyncio.run(provider(CodexProvider, {"models": ["custom-model", "default", "custom-model"]}).list_models())
    assert [m.name for m in models] == ["default", "custom-model"]


def test_codex_oss_does_not_list_cloud_catalog(tmp_path, monkeypatch):
    monkeypatch.setenv("CODEX_HOME", str(tmp_path))
    (tmp_path / "models_cache.json").write_text('{"models": [{"slug": "cloud-model"}]}')
    models = asyncio.run(provider(CodexProvider, {"oss": True, "models": ["local-model"]}).list_models())
    assert [m.name for m in models] == ["default", "local-model"]


def test_claude_aliases_have_labels_and_are_not_duplicated():
    models = asyncio.run(provider(ClaudeCodeProvider).list_models())
    assert [m.name for m in models] == ["default", "opus", "sonnet", "haiku"]
    assert models[1].details["display_name"] == "Claude Opus"
    assert models[1].details["description"]
    models = asyncio.run(provider(ClaudeCodeProvider, {"models": ["default", "sonnet", "sonnet"]}).list_models())
    assert [m.name for m in models] == ["default", "sonnet"]


def test_cli_health_cancellation_reaps_process(monkeypatch):
    from atlas.providers import cli_agents

    async def check():
        started = asyncio.Event()
        class Process:
            returncode = None
            terminated = False
            calls = 0
            async def communicate(self):
                self.calls += 1
                if self.calls == 1:
                    started.set()
                    await asyncio.Event().wait()
                return b"", b""
            def terminate(self):
                self.terminated = True
                self.returncode = 0
            async def wait(self):
                return self.returncode
        process = Process()
        async def spawn(*args, **kwargs):
            return process
        monkeypatch.setattr(cli_agents, "find_binary", lambda *args: "/demo/claude")
        monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
        task = asyncio.create_task(provider(ClaudeCodeProvider).health())
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert process.terminated
        assert process.calls == 2
    asyncio.run(check())
