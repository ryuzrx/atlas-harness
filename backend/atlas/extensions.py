"""Skills, plugins and hooks, discovered from folders the user chooses.

Skills   <skills_dir>/<name>/SKILL.md   (frontmatter: name, description; the body is the instructions)
Plugins  <plugins_dir>/<name>/plugin.json, optional skills/ folder and hooks.json
Hooks    <hooks_dir>/hooks.json         {"PreToolUse": [{"matcher": "run_command", "command": "..."}], ...}

Skills are plain instructions. Hooks run user-written shell commands, so they are off until the user turns them on.
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .config import data_dir
from .security import scrubbed_env, shell_argv

MAX_SKILL_BYTES = 200_000
MAX_SKILLS = 800
HOOK_EVENTS = ("PreToolUse", "PostToolUse")
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")

KEYS = {"skills": "extensions.skills_dir", "plugins": "extensions.plugins_dir", "hooks": "extensions.hooks_dir"}


def default_dir(kind: str) -> Path:
    return data_dir() / kind


def folder(settings: Dict[str, Any], kind: str) -> Path:
    custom = str(settings.get(KEYS[kind]) or "").strip()
    return Path(custom).expanduser() if custom else default_dir(kind)


def ensure_default_dirs() -> None:
    for kind in KEYS:
        default_dir(kind).mkdir(parents=True, exist_ok=True)


def _frontmatter(text: str) -> Tuple[Dict[str, str], str]:
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end < 0:
        return {}, text
    meta: Dict[str, str] = {}
    for line in text[3:end].splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip().lower()] = v.strip().strip("\"'")
    return meta, text[end + 4:].lstrip("\n")


def _read_json(p: Path) -> Any:
    return json.loads(p.read_text(encoding="utf-8"))


def list_plugins(settings: Dict[str, Any]) -> List[Dict[str, Any]]:
    root = folder(settings, "plugins")
    disabled = set(settings.get("extensions.disabled_plugins") or [])
    out: List[Dict[str, Any]] = []
    if not root.is_dir():
        return out
    for d in sorted(root.iterdir()):
        manifest = d / "plugin.json"
        if not (d.is_dir() and manifest.is_file()):
            continue
        info: Dict[str, Any] = {"id": d.name, "name": d.name, "version": "", "description": "", "path": str(d),
                                "enabled": d.name not in disabled, "error": None,
                                "skills": 0, "hooks": (d / "hooks.json").is_file()}
        try:
            m = _read_json(manifest)
            info["name"] = str(m.get("name") or d.name)
            info["version"] = str(m.get("version") or "")
            info["description"] = str(m.get("description") or "")
        except Exception as e:  # noqa: BLE001
            info["error"] = f"plugin.json: {e}"
        sk = d / "skills"
        info["skills"] = sum(1 for s in sk.iterdir() if (s / "SKILL.md").is_file()) if sk.is_dir() else 0
        out.append(info)
    return out


def _scan_skills(root: Path, source: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if not root.is_dir():
        return out
    for d in sorted(root.iterdir()):
        f = d / "SKILL.md"
        if not (d.is_dir() and f.is_file()):
            continue
        try:
            if f.stat().st_size > MAX_SKILL_BYTES:
                continue
            meta, body = _frontmatter(f.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            continue
        name = meta.get("name") or d.name
        desc = meta.get("description") or next((ln.strip() for ln in body.splitlines() if ln.strip()), "")[:200]
        out.append({"name": name, "description": desc, "path": str(f), "source": source, "folder": d.name})
    return out


def list_skills(settings: Dict[str, Any], *, only_enabled: bool = False) -> List[Dict[str, Any]]:
    skills = _scan_skills(folder(settings, "skills"), "user")
    seen = {s["name"] for s in skills}
    for p in list_plugins(settings):
        if p["enabled"] and not p["error"]:
            for s in _scan_skills(Path(p["path"]) / "skills", p["name"]):
                if s["name"] not in seen:
                    seen.add(s["name"])
                    skills.append(s)
    off = set(settings.get("extensions.disabled_skills") or [])
    for s in skills:
        s["enabled"] = s["name"] not in off
    skills = skills[:MAX_SKILLS]
    return [s for s in skills if s["enabled"]] if only_enabled else skills


def read_skill(settings: Dict[str, Any], name: str) -> Optional[str]:
    for s in list_skills(settings, only_enabled=True):
        if s["name"].lower() == name.lower():
            return _frontmatter(Path(s["path"]).read_text(encoding="utf-8", errors="replace"))[1].strip()
    return None


def skills_prompt(settings: Dict[str, Any]) -> str:
    skills = list_skills(settings, only_enabled=True)
    if not skills:
        return ""
    lines = "\n".join(f"- {s['name']}: {s['description'][:160]}" for s in skills[:60])
    return ("Skills are reusable instructions the user installed. When one clearly matches the task, load it with the "
            "`skill` tool (pass its name) before starting, then follow it.\nAvailable skills:\n" + lines)


def create_skill(settings: Dict[str, Any], name: str, description: str, body: str) -> Dict[str, Any]:
    if not NAME_RE.match(name):
        raise ValueError("Use lowercase letters, numbers, dots, dashes or underscores (max 64 characters).")
    root = folder(settings, "skills")
    d = root / name
    if d.exists():
        raise ValueError(f"A skill named '{name}' already exists.")
    d.mkdir(parents=True)
    desc = " ".join(description.split())
    (d / "SKILL.md").write_text(f"---\nname: {name}\ndescription: {desc}\n---\n\n{body.strip()}\n", encoding="utf-8")
    return {"name": name, "path": str(d / "SKILL.md")}


# ------------------------------------------------------------------ hooks

def load_hooks(settings: Dict[str, Any], *, force: bool = False) -> List[Dict[str, Any]]:
    """Hook entries from the hooks folder and enabled plugins. Empty unless the user enabled hooks."""
    if not force and not settings.get("extensions.hooks_enabled"):
        return []
    files = [(folder(settings, "hooks") / "hooks.json", "user")]
    files += [(Path(p["path"]) / "hooks.json", p["name"]) for p in list_plugins(settings) if p["enabled"] and not p["error"]]
    out: List[Dict[str, Any]] = []
    for f, source in files:
        if not f.is_file():
            continue
        try:
            data = _read_json(f)
        except Exception:  # noqa: BLE001
            continue
        data = data.get("hooks", data) if isinstance(data, dict) else {}
        for event in HOOK_EVENTS:
            for h in data.get(event) or []:
                if isinstance(h, dict) and isinstance(h.get("command"), str) and h["command"].strip():
                    out.append({"id": str(h.get("id") or ""), "event": event, "matcher": str(h.get("matcher") or "*"), "command": h["command"],
                                "label": str(h.get("label") or ""), "enabled": h.get("enabled") is not False, "block": bool(h.get("block")),
                                "timeout": min(max(int(h.get("timeout") or 10), 1), 60), "source": source})
    return out


def _matches(matcher: str, tool: str) -> bool:
    if matcher in ("", "*"):
        return True
    try:
        return re.fullmatch(matcher, tool) is not None
    except re.error:
        return False


async def run_hooks(event: str, tool: str, args: Dict[str, Any], output: Optional[str], workspace: Path,
                    settings: Dict[str, Any]) -> Optional[str]:
    """Run matching hooks. A PreToolUse hook that exits with status 2 blocks the call; its stderr is returned."""
    block: Optional[str] = None
    for h in load_hooks(settings):
        if not h["enabled"] or h["event"] != event or not _matches(h["matcher"], tool):
            continue
        payload = json.dumps({"event": event, "tool": tool, "arguments": args, "output": output,
                              "workspace": str(workspace)})
        try:
            proc = await asyncio.create_subprocess_exec(
                *shell_argv(h["command"]), cwd=str(workspace), env=scrubbed_env(),
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            try:
                _, err = await asyncio.wait_for(proc.communicate(payload.encode()), timeout=h["timeout"])
            except asyncio.TimeoutError:
                proc.kill()
                continue
            if event == "PreToolUse" and block is None and (proc.returncode == 2 or (h["block"] and proc.returncode != 0)):
                block = (err.decode(errors="replace").strip() or "blocked by hook")[:500]
        except Exception:  # noqa: BLE001 - a broken hook must never break the agent
            continue
    return block


# ------------------------------------------------------------------ simple management (used by the Settings UI)

MAX_COPY_BYTES = 20_000_000
MAX_COPY_FILES = 500


def _safe_copy(src: Path, dst: Path) -> None:
    """Copy a folder, skipping symlinks, with size and file-count limits."""
    files = [f for f in src.rglob("*") if f.is_file() and not f.is_symlink() and ".git" not in f.relative_to(src).parts]
    if len(files) > MAX_COPY_FILES or sum(f.stat().st_size for f in files) > MAX_COPY_BYTES:
        raise ValueError("That folder is too large to install.")
    for f in files:
        t = dst / f.relative_to(src)
        t.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, t)


def install_name(src: Path) -> str:
    return re.sub(r"[^a-z0-9._-]+", "-", src.name.lower()).strip("-.") or "item"


def install(settings: Dict[str, Any], kind: str, path: str) -> Dict[str, Any]:
    """Copy a skill or plugin folder into Atlas's folder so people never touch folders by hand."""
    src = Path(path).expanduser()
    if src.is_file() and src.name == "SKILL.md":
        src = src.parent
    if not src.is_dir():
        raise ValueError("Choose a folder.")
    marker = "SKILL.md" if kind == "skills" else "plugin.json"
    if not (src / marker).is_file():
        raise ValueError(f"That folder has no {marker}, so it isn't a {'skill' if kind == 'skills' else 'plugin'}.")
    name = install_name(src)
    dst = folder(settings, kind) / name
    if dst.exists():
        raise ValueError(f"'{name}' is already installed.")
    dst.mkdir(parents=True)
    try:
        _safe_copy(src, dst)
    except Exception:
        shutil.rmtree(dst, ignore_errors=True)
        raise
    return {"name": name}


def remove(settings: Dict[str, Any], kind: str, name: str) -> None:
    root = folder(settings, kind).resolve()
    target = (root / name).resolve()
    if target.parent != root or not target.is_dir():
        raise ValueError("Not found.")
    shutil.rmtree(target)


HOOK_WHEN = {
    "before_command": ("PreToolUse", "run_command"), "after_command": ("PostToolUse", "run_command"),
    "before_edit": ("PreToolUse", "write_file|edit_file|apply_patch"), "after_edit": ("PostToolUse", "write_file|edit_file|apply_patch"),
    "before_any": ("PreToolUse", "*"), "after_any": ("PostToolUse", "*"),
}


def _hooks_file(settings: Dict[str, Any]) -> Path:
    return folder(settings, "hooks") / "hooks.json"


def _read_user_hooks(settings: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    f = _hooks_file(settings)
    try:
        data = _read_json(f) if f.is_file() else {}
    except Exception:  # noqa: BLE001
        data = {}
    data = data.get("hooks", data) if isinstance(data, dict) else {}
    return {e: [h for h in (data.get(e) or []) if isinstance(h, dict)] for e in HOOK_EVENTS}


def _write_user_hooks(settings: Dict[str, Any], data: Dict[str, List[Dict[str, Any]]]) -> None:
    f = _hooks_file(settings)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(data, indent=2), encoding="utf-8")


def add_hook(settings: Dict[str, Any], label: str, when: str, command: str, block: bool) -> Dict[str, Any]:
    if when not in HOOK_WHEN:
        raise ValueError("Choose when the hook should run.")
    if not command.strip():
        raise ValueError("Enter the command to run.")
    event, matcher = HOOK_WHEN[when]
    data = _read_user_hooks(settings)
    h = {"id": uuid.uuid4().hex[:8], "label": label.strip(), "matcher": matcher, "command": command.strip(),
         "enabled": True, "block": bool(block and event == "PreToolUse")}
    data[event].append(h)
    _write_user_hooks(settings, data)
    return h


def update_hook(settings: Dict[str, Any], hook_id: str, enabled: Optional[bool], delete: bool = False) -> None:
    data = _read_user_hooks(settings)
    for event in HOOK_EVENTS:
        for h in list(data[event]):
            if h.get("id") == hook_id:
                if delete:
                    data[event].remove(h)
                elif enabled is not None:
                    h["enabled"] = enabled
                _write_user_hooks(settings, data)
                return
    raise ValueError("Hook not found.")


# ------------------------------------------------------------------ bundled skill packs
PACKS_DIR = Path(__file__).parent / "skillpacks"


def list_packs(settings: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Skill packs that ship with Atlas, with which of their skills are already installed."""
    have = {d.name for d in folder(settings, "skills").iterdir() if d.is_dir()} if folder(settings, "skills").is_dir() else set()
    out: List[Dict[str, Any]] = []
    if not PACKS_DIR.is_dir():
        return out
    for d in sorted(PACKS_DIR.iterdir()):
        try:
            meta = _read_json(d / "pack.json")
        except Exception:  # noqa: BLE001
            continue
        skills = []
        for s in _scan_skills(d, "pack"):
            skills.append({"name": s["folder"], "description": s["description"], "installed": s["folder"] in have})
        out.append({"id": meta.get("id") or d.name, "name": meta.get("name") or d.name, "description": meta.get("description") or "",
                    "source_repo": meta.get("source_repo"), "source_revision": meta.get("source_revision"),
                    "source_url": meta.get("source_url"), "license": meta.get("license"),
                    "skills": skills, "installed": sum(1 for s in skills if s["installed"])})
    return out


def install_pack(settings: Dict[str, Any], pack_id: str, names: Optional[List[str]] = None) -> Dict[str, int]:
    src = (PACKS_DIR / pack_id).resolve()
    if src.parent != PACKS_DIR.resolve() or not (src / "pack.json").is_file():
        raise ValueError("Unknown skill pack.")
    dest = folder(settings, "skills")
    dest.mkdir(parents=True, exist_ok=True)
    added = skipped = 0
    meta = _read_json(src / "pack.json")
    upstream_license = src / "LICENSE"
    for d in sorted(src.iterdir()):
        if not (d.is_dir() and (d / "SKILL.md").is_file()) or (names is not None and d.name not in names):
            continue
        if (dest / d.name).exists():
            skipped += 1
            continue
        target = dest / d.name
        _safe_copy(d, target)
        for f in target.rglob("*"):
            if f.is_file():
                f.chmod(0o644)
        if meta.get("source_repo"):
            if upstream_license.is_file():
                shutil.copyfile(upstream_license, target / "ATLAS_UPSTREAM_LICENSE.txt")
            (target / ".atlas-source.json").write_text(json.dumps({
                "repository": meta["source_repo"], "revision": meta.get("source_revision"),
                "url": meta.get("source_url"), "license": meta.get("license"),
                "skill": d.name,
            }, indent=2), encoding="utf-8")
        added += 1
    return {"added": added, "skipped": skipped}
