"""Find project folders you already use with other AI coding tools, so they can be added to Atlas.

Only folder *paths* are read, from each tool's local files, read-only. Conversation content is never
read, and nothing leaves the Mac. Each source is optional: a missing or unreadable tool is skipped.

Formats (as stored by the tools themselves):
  Claude Code   ~/.claude.json  -> "projects": {"/abs/path": {...}}
                ~/.claude/projects/*/*.jsonl -> per-line "cwd"
  Codex CLI     ~/.codex/config.toml -> [projects."/abs/path"]
                ~/.codex/sessions/**/*.jsonl -> first line payload.cwd
  OpenCode      ~/.local/share/opencode/opencode.db -> project.worktree, project_directory.directory, session.directory
  VS Code and forks (Cursor, Windsurf, VSCodium)
                ~/Library/Application Support/<App>/User/workspaceStorage/*/workspace.json -> "folder": "file:///..."
"""
from __future__ import annotations

import glob
import json
import os
import re
import sqlite3
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Tuple
from urllib.parse import unquote, urlparse

Found = Tuple[str, float]  # (absolute path, last-used unix time; 0 if unknown)

HOME = Path.home()
VSCODE_FAMILY = [("vscode", "VS Code", "Code"), ("cursor", "Cursor", "Cursor"), ("windsurf", "Windsurf", "Windsurf"),
                 ("vscodium", "VSCodium", "VSCodium")]


def _home() -> Path:
    return Path(os.environ.get("ATLAS_IMPORT_HOME") or HOME)  # overridable for tests


def _mtime(p: str) -> float:
    try:
        return os.path.getmtime(p)
    except OSError:
        return 0.0


def _first_json_lines(path: str, n: int) -> Iterable[dict]:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for _ in range(n):
                line = f.readline()
                if not line:
                    return
                try:
                    yield json.loads(line)
                except ValueError:
                    continue
    except OSError:
        return


# ---------------------------------------------------------------- sources
def claude_code() -> List[Found]:
    h = _home()
    out: List[Found] = []
    cfg = h / ".claude.json"
    if cfg.is_file():
        try:
            projects = (json.loads(cfg.read_text(errors="replace")) or {}).get("projects") or {}
            out += [(p, 0.0) for p in projects if isinstance(p, str) and p.startswith("/")]
        except ValueError:
            pass
    for f in glob.glob(str(h / ".claude" / "projects" / "*" / "*.jsonl"))[:2000]:
        for rec in _first_json_lines(f, 20):
            cwd = rec.get("cwd") if isinstance(rec, dict) else None
            if isinstance(cwd, str) and cwd.startswith("/"):
                out.append((cwd, _mtime(f)))
                break
    return out


def codex() -> List[Found]:
    h = _home()
    out: List[Found] = []
    cfg = h / ".codex" / "config.toml"
    if cfg.is_file():
        for m in re.finditer(r'^\[projects\."((?:[^"\\]|\\.)+)"\]', cfg.read_text(errors="replace"), re.M):
            out.append((m.group(1).replace('\\"', '"').replace("\\\\", "\\"), 0.0))
    for f in glob.glob(str(h / ".codex" / "sessions" / "**" / "*.jsonl"), recursive=True)[:5000]:
        for rec in _first_json_lines(f, 3):
            cwd = (rec.get("payload") or {}).get("cwd") if isinstance(rec, dict) else None
            if isinstance(cwd, str) and cwd.startswith("/"):
                out.append((cwd, _mtime(f)))
                break
    return out


def opencode() -> List[Found]:
    db = _home() / ".local" / "share" / "opencode" / "opencode.db"
    if not db.is_file():
        return []
    out: List[Found] = []
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=2)
        try:
            tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}

            def cols(t: str) -> set:
                return {r[1] for r in con.execute(f"PRAGMA table_info('{t}')")}
            if "project" in tables and "worktree" in cols("project"):
                has_t = "time_updated" in cols("project")
                for row in con.execute("SELECT worktree" + (", time_updated" if has_t else "") + " FROM project"):
                    t = float(row[1] or 0) if has_t else 0.0
                    out.append((row[0], t / 1000 if t > 1e11 else t))   # OpenCode stores milliseconds
            for t in ("project_directory", "session"):
                if t in tables and "directory" in cols(t):
                    for (d,) in con.execute(f"SELECT DISTINCT directory FROM {t}"):
                        out.append((d, 0.0))
        finally:
            con.close()
    except sqlite3.Error:
        return out
    return [(p, t) for p, t in out if isinstance(p, str) and p.startswith("/")]


def vscode_like(app_dir: str) -> Callable[[], List[Found]]:
    def scan() -> List[Found]:
        base = _home() / "Library" / "Application Support" / app_dir / "User" / "workspaceStorage"
        out: List[Found] = []
        for f in glob.glob(str(base / "*" / "workspace.json"))[:3000]:
            try:
                folder = (json.loads(Path(f).read_text(errors="replace")) or {}).get("folder")
            except (ValueError, OSError):
                continue
            if isinstance(folder, str) and folder.startswith("file://"):
                out.append((unquote(urlparse(folder).path), _mtime(os.path.dirname(f))))
        return out
    return scan


SOURCES: List[Tuple[str, str, Callable[[], List[Found]]]] = [
    ("claude_code", "Claude Code", claude_code),
    ("codex", "Codex CLI", codex),
    ("opencode", "OpenCode", opencode),
    *[(i, label, vscode_like(d)) for i, label, d in VSCODE_FAMILY],
]


# ---------------------------------------------------------------- skills
SKILL_ROOTS = [("Claude Code", ".claude/skills"), ("Codex CLI", ".codex/skills")]


def skill_roots() -> List[Path]:
    return [(_home() / rel).resolve() for _, rel in SKILL_ROOTS]


def skills() -> List[Dict[str, object]]:
    """Skill folders (SKILL.md) other tools keep on this Mac. Read-only; names and descriptions only."""
    from .extensions import _frontmatter
    out: List[Dict[str, object]] = []
    for label, rel in SKILL_ROOTS:
        root = _home() / rel
        if not root.is_dir():
            continue
        files = sorted(glob.glob(str(root / "*" / "SKILL.md"))) + sorted(glob.glob(str(root / "*" / "*" / "SKILL.md")))
        for f in files[:300]:
            d = Path(f).parent
            if any(part.startswith(".") for part in d.relative_to(root).parts):
                continue
            try:
                if os.path.getsize(f) > 200_000:
                    continue
                meta, body = _frontmatter(Path(f).read_text(encoding="utf-8", errors="replace"))
            except OSError:
                continue
            desc = meta.get("description") or next((ln.strip() for ln in body.splitlines() if ln.strip()), "")
            out.append({"name": meta.get("name") or d.name, "description": desc[:200], "source": label, "path": str(d)})
    return out


# ---------------------------------------------------------------- aggregate
def _skip(p: Path) -> Optional[str]:
    """Folders that should never be offered: home, root, temp and app-data locations."""
    s = str(p)
    h = _home()
    if p in (h, Path("/")) or p == h.parent:
        return "home"
    under_home = s.startswith(str(h) + "/")
    for prefix in ("/private/tmp", "/tmp", "/private/var", "/var/folders", "/System", "/Library", "/Applications"):
        if under_home:
            break
        if s == prefix or s.startswith(prefix + "/"):
            return "system"
    try:
        rel = p.relative_to(h).parts
    except ValueError:
        rel = ()
    if rel and rel[0].startswith("."):                       # ~/.config, ~/.cache, …
        return "app-data"
    if rel and rel[0] == "Library" and not (len(rel) > 1 and rel[1] == "Mobile Documents"):  # keep iCloud Drive
        return "app-data"
    return None


def scan(existing_paths: Iterable[str] = ()) -> Dict[str, object]:
    existing = {str(Path(p)) for p in existing_paths}
    tools = []
    merged: Dict[str, Dict[str, object]] = {}
    for sid, label, fn in SOURCES:
        try:
            found = fn()
        except Exception:  # noqa: BLE001 - one broken tool must not hide the others
            found = []
        paths = set()
        for raw, t in found:
            try:
                p = Path(raw).expanduser().resolve()
            except (OSError, RuntimeError):
                continue
            if _skip(p) or not p.is_dir():
                continue
            key = str(p)
            paths.add(key)
            e = merged.setdefault(key, {"path": key, "name": p.name, "sources": [], "last_used": 0.0,
                                        "is_repo": (p / ".git").exists(), "added": key in existing})
            if label not in e["sources"]:
                e["sources"].append(label)
            e["last_used"] = max(float(e["last_used"]), float(t or 0))
        tools.append({"id": sid, "label": label, "count": len(paths)})
    folders = sorted(merged.values(), key=lambda e: (-float(e["last_used"]), str(e["name"]).lower()))[:300]
    return {"tools": tools, "folders": folders}
