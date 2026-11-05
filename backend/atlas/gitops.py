"""Git integration: repository detection, isolated worktrees, diffs, conflict detection, controlled merges."""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import worktrees_dir


class GitError(Exception):
    pass


def git(cwd: Path, *args: str, check: bool = True, timeout: int = 60) -> str:
    r = subprocess.run(["git", *args], cwd=str(cwd), capture_output=True, text=True, timeout=timeout,
                       env={"GIT_TERMINAL_PROMPT": "0", "PATH": "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin",
                            "HOME": str(Path.home()), "LANG": "en_US.UTF-8"})
    if check and r.returncode != 0:
        raise GitError(f"git {' '.join(args)}: {r.stderr.strip() or r.stdout.strip()}")
    return r.stdout


def is_repo(path: Path) -> bool:
    try:
        return git(path, "rev-parse", "--is-inside-work-tree", check=False).strip() == "true"
    except Exception:  # noqa: BLE001
        return False


def repo_root(path: Path) -> Path:
    return Path(git(path, "rev-parse", "--show-toplevel").strip())


def current_branch(path: Path) -> str:
    return git(path, "rev-parse", "--abbrev-ref", "HEAD").strip()


def head(path: Path) -> str:
    return git(path, "rev-parse", "HEAD").strip()


def has_commits(path: Path) -> bool:
    return git(path, "rev-parse", "--verify", "HEAD", check=False).strip() != ""


def status(path: Path) -> List[Dict[str, str]]:
    out = []
    for line in git(path, "status", "--porcelain=v1", "-uall").splitlines():
        if line.strip():
            out.append({"code": line[:2], "path": line[3:]})
    return out


def info(path: Path) -> Dict[str, Any]:
    if not is_repo(path):
        return {"is_repo": False}
    d: Dict[str, Any] = {"is_repo": True, "root": str(repo_root(path))}
    if has_commits(path):
        d["branch"] = current_branch(path)
        d["head"] = head(path)
        d["log"] = log(path, 15)
    else:
        d["branch"] = None
        d["log"] = []
    d["dirty"] = status(path)
    added = removed = 0
    if d["branch"]:
        for line in git(path, "diff", "--numstat", "HEAD", check=False).splitlines():
            parts = line.split("\t")
            if len(parts) >= 2:
                added += int(parts[0]) if parts[0].isdigit() else 0
                removed += int(parts[1]) if parts[1].isdigit() else 0
    d["added"], d["removed"] = added, removed
    d["branches"] = [b.strip() for b in git(path, "branch", "--format=%(refname:short)").splitlines() if b.strip()]
    d["worktrees"] = worktree_list(path)
    return d


def log(path: Path, n: int = 20, ref: str = "HEAD") -> List[Dict[str, str]]:
    out = git(path, "log", f"-{n}", "--format=%H%x1f%an%x1f%ar%x1f%s", ref, check=False)
    rows = []
    for line in out.splitlines():
        parts = line.split("\x1f")
        if len(parts) == 4:
            rows.append({"sha": parts[0], "author": parts[1], "when": parts[2], "subject": parts[3]})
    return rows


def worktree_list(path: Path) -> List[Dict[str, str]]:
    out = git(path, "worktree", "list", "--porcelain", check=False)
    items, cur = [], {}
    for line in out.splitlines():
        if not line.strip():
            if cur:
                items.append(cur)
            cur = {}
            continue
        k, _, v = line.partition(" ")
        cur[k] = v
    if cur:
        items.append(cur)
    return items


def create_worktree(repo: Path, task_id: str, project_slug: str, base_ref: Optional[str] = None) -> Dict[str, str]:
    """Create `atlas/<task>` branch in a worktree outside the user's checkout. User files are never touched."""
    if not has_commits(repo):
        raise GitError("Repository has no commits yet; create an initial commit before running isolated tasks.")
    base = base_ref or head(repo)
    branch = f"atlas/{task_id}"
    dest = worktrees_dir() / project_slug / task_id
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        return {"path": str(dest), "branch": branch, "base": base}
    git(repo, "worktree", "add", "-b", branch, str(dest), base)
    return {"path": str(dest), "branch": branch, "base": base}


def remove_worktree(repo: Path, path: str, branch: Optional[str] = None, delete_branch: bool = False) -> None:
    git(repo, "worktree", "remove", "--force", path, check=False)
    if delete_branch and branch:
        git(repo, "branch", "-D", branch, check=False)


def commit_all(worktree: Path, message: str) -> Optional[str]:
    if not status(worktree):
        return None
    git(worktree, "add", "-A")
    git(worktree, "-c", "user.name=ATLAS Harness", "-c", "user.email=atlas@localhost", "commit", "-m", message, "--no-verify")
    return head(worktree)


def diff(cwd: Path, base: str, ref: str = "HEAD", stat: bool = False) -> str:
    args = ["diff", "--stat" if stat else "--patch", f"{base}...{ref}"] if ref else ["diff", base]
    return git(cwd, *args, check=False)


def changed_files(cwd: Path, base: str, ref: str = "HEAD") -> List[str]:
    return [l for l in git(cwd, "diff", "--name-only", f"{base}...{ref}", check=False).splitlines() if l]


def working_diff(cwd: Path) -> str:
    return git(cwd, "diff", "HEAD", check=False)


def merge_preview(repo: Path, branch: str, into: Optional[str] = None) -> Dict[str, Any]:
    """Detect conflicts without touching the working tree (git merge-tree --write-tree, git >= 2.38)."""
    target = into or current_branch(repo)
    r = subprocess.run(["git", "merge-tree", "--write-tree", "--name-only", "--no-messages", target, branch],
                       cwd=str(repo), capture_output=True, text=True)
    lines = r.stdout.splitlines()
    conflicts = lines[1:] if r.returncode == 1 else []
    return {"target": target, "branch": branch, "clean": r.returncode == 0, "conflicts": [c for c in conflicts if c],
            "files": changed_files(repo, target, branch), "error": r.stderr.strip() if r.returncode > 1 else None}


def merge(repo: Path, branch: str, *, protected: List[str], confirm_protected: bool) -> Dict[str, Any]:
    target = current_branch(repo)
    if target in protected and not confirm_protected:
        raise GitError(f"'{target}' is a protected branch. Explicit confirmation is required to merge into it.")
    preview = merge_preview(repo, branch, target)
    if not preview["clean"]:
        raise GitError(f"Merge would conflict in: {', '.join(preview['conflicts']) or 'unknown files'}")
    dirty = {d["path"] for d in status(repo)}
    overlap = dirty.intersection(preview["files"])
    if overlap:
        raise GitError(f"Uncommitted local changes touch files in this merge: {', '.join(sorted(overlap))}. "
                       "Commit or stash them first; ATLAS will not overwrite your changes.")
    before = head(repo)
    git(repo, "-c", "user.name=ATLAS Harness", "-c", "user.email=atlas@localhost",
        "merge", "--no-ff", "--no-edit", "-m", f"Merge {branch} (ATLAS Harness)", branch)
    return {"merged": True, "target": target, "before": before, "after": head(repo)}


def revert_merge(repo: Path, merge_sha: str) -> str:
    """Non-destructive rollback: creates a revert commit instead of resetting history."""
    git(repo, "-c", "user.name=ATLAS Harness", "-c", "user.email=atlas@localhost", "revert", "-m", "1", "--no-edit", merge_sha)
    return head(repo)


def overlapping_branches(repo: Path, branches: Dict[str, str], base: str) -> List[Dict[str, Any]]:
    """Find parallel task branches that changed the same files (potential conflicts)."""
    files = {tid: set(changed_files(repo, base, br)) for tid, br in branches.items()}
    out = []
    ids = list(files)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            both = files[a] & files[b]
            if both:
                out.append({"tasks": [a, b], "files": sorted(both)})
    return out
