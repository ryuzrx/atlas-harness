"""Paths and runtime configuration."""
from __future__ import annotations

import os
from pathlib import Path


def data_dir() -> Path:
    override = os.environ.get("ATLAS_DATA_DIR")
    if override:
        p = Path(override).expanduser()
    else:
        p = Path.home() / "Library" / "Application Support" / "ATLAS Harness"
    p.mkdir(parents=True, exist_ok=True)
    return p


def worktrees_dir() -> Path:
    p = data_dir() / "worktrees"
    p.mkdir(parents=True, exist_ok=True)
    return p


def bin_dir() -> Path:
    """User-local binaries (e.g. an Ollama install that needs no admin rights)."""
    p = data_dir() / "bin"
    p.mkdir(parents=True, exist_ok=True)
    return p


def logs_dir() -> Path:
    p = data_dir() / "logs"
    p.mkdir(parents=True, exist_ok=True)
    return p


DEFAULT_SETTINGS = {
    "general.theme": "dark",
    "appearance.palette": "atlas",
    "appearance.custom_palettes": [],
    "profile.name": "",
    "profile.avatar": "",      # small square image (data URL), stored on this Mac only
    "profile.workspace": "",  # label shown under your name
    "onboarding.completed": False,
    "legal.acknowledged": "",  # version of the usage notice the user acknowledged
    "general.reduce_motion": False,
    "general.ui_scale": 1.0,       # 0.9 | 1.0 | 1.1 | 1.2 (interface size)
    "chat.width": "normal",        # normal | wide
    "chat.send_key": "enter",      # enter | mod_enter
    "chat.confirm_delete": True,   # ask before deleting a conversation
    "extensions.skills_dir": "",   # empty = <data dir>/skills
    "extensions.plugins_dir": "",
    "extensions.hooks_dir": "",
    "extensions.hooks_enabled": False,  # hooks run user-written shell commands, so they are opt-in
    "extensions.disabled_plugins": [],
    "extensions.disabled_skills": [],
    "general.launch_view": "last", # last | chat | work
    "chat.font_size": "default",   # small | default | large
    "chat.group_history": True,    # group the sidebar chat list by day
    "chat.history_limit": 50,      # chats listed in the sidebar (0 = all)
    "chat.spellcheck": True,
    "general.notify_when_focused": False,
    "models.default_tab": "last",  # last | endpoints | models
    "projects.confirm_remove": True,
    "projects.sort": "name",       # name | added
    "projects.history_limit": 25,  # commits shown in a project's history
    "models.default_sort": "name", # name | size | context
    "general.notifications": True,
    "execution.max_concurrent_tasks": 3,
    "execution.max_concurrent_inference": 2,
    "execution.max_agent_steps": 40,
    "execution.command_timeout_s": 120,
    "execution.task_timeout_s": 1800,
    "execution.max_retries": 1,
    "execution.require_plan_approval": False,
    "execution.use_worktrees": True,
    "execution.sandbox_commands": True,
    "execution.allow_network_in_commands": True,
    "permissions.command_policy": "ask",  # ask | allowlist | auto
    "permissions.allowlist": [
        "ls", "cat", "pwd", "echo", "head", "tail", "wc", "grep", "rg", "find", "tree",
        "git status", "git diff", "git log", "git show", "git branch",
        "python -m pytest", "python3 -m pytest", "pytest", "npm test", "npm run test",
        "npm run build", "npm run lint", "cargo test", "cargo build", "go test", "go build",
        "make test", "swift test", "node", "python", "python3",
    ],
    "permissions.protected_branches": ["main", "master", "release", "production"],
    "permissions.block_secret_files": True,
    "agents.default_temperature": 0.2,
    "agents.default_tools": ["read", "write", "shell", "git", "messages", "memory"],  # abilities new agents start with
    "teams.default_template": "engineering",
    "teams.confirm_delete": True,
    "agents.default_context_budget": 16000,
    "models.ollama_url": "http://127.0.0.1:11434",
    "models.ollama_dir": "",
    "models.keep_alive": "10m",
    "models.routing": {},  # tier -> {"provider_id", "model"}; tiers: reasoning | coding | light
    "storage.event_retention": 20000,
    "integrations.mcp_servers": [],
    "shortcuts": {
        "palette": "mod+k", "new_task": "mod+n", "toggle_sidebar": "mod+b",
        "overview": "mod+1", "teams": "mod+2", "agents": "mod+3", "settings": "mod+,",
    },
}
