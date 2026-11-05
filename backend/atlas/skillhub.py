"""Find open-source skills on GitHub and add them, only when the user asks.

Atlas contacts github.com when you search or open a repository, and nowhere else. Only repositories with an
open-source licence can be added; anything without one (all rights reserved by default) is shown but blocked,
because Atlas must not copy work it has no licence to use. Skills are plain instructions: files are copied as text
with no executable bit, and nothing is run."""
from __future__ import annotations

import io
import json
import re
import stat
import time
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

from .config import data_dir
from .extensions import _frontmatter, folder

API = "https://api.github.com"
HEADERS = {"Accept": "application/vnd.github+json", "User-Agent": "Atlas-Skills"}
OPEN_LICENSES = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MPL-2.0", "Unlicense", "CC0-1.0", "0BSD", "Zlib",
                 "CC-BY-4.0", "CC-BY-SA-4.0", "GPL-2.0", "GPL-3.0", "LGPL-2.1", "LGPL-3.0", "AGPL-3.0", "BSL-1.0"}
PART = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
MAX_ZIP = 60_000_000
MAX_SKILLS = 1500
MAX_FILES_PER_SKILL = 60
MAX_BYTES_PER_SKILL = 2_000_000
CACHE_TTL = 3600

# Well-known open-source collections (licence checked live before anything is added).
FEATURED = [
    {"full_name": "alirezarezvani/claude-skills", "description": "Hundreds of skills across engineering, product, marketing and more."},
    {"full_name": "addyosmani/agent-skills", "description": "Production-grade engineering skills."},
    {"full_name": "obra/superpowers", "description": "A complete software development workflow as skills."},
    {"full_name": "coreyhaines31/marketingskills", "description": "Marketing skills: copywriting, SEO, conversion."},
    {"full_name": "wshobson/agents", "description": "A large marketplace of specialised agents and skills."},
]


class HubError(Exception):
    pass


def _check(owner: str, repo: str) -> None:
    if not (PART.match(owner) and PART.match(repo)):
        raise HubError("Invalid repository name.")


def _cache_dir() -> Path:
    p = data_dir() / "cache" / "skillhub"
    p.mkdir(parents=True, exist_ok=True)
    for f in p.glob("*.zip"):
        if time.time() - f.stat().st_mtime > CACHE_TTL:
            f.unlink(missing_ok=True)
    return p


def _cache_path(owner: str, repo: str) -> Path:
    return _cache_dir() / f"{owner}__{repo}.zip"


def _repo_row(r: Dict[str, Any]) -> Dict[str, Any]:
    lic = (r.get("license") or {}).get("spdx_id") or ""
    return {"full_name": r["full_name"], "description": (r.get("description") or "")[:200], "stars": r.get("stargazers_count", 0),
            "license": lic if lic and lic != "NOASSERTION" else "", "open": lic in OPEN_LICENSES, "url": r.get("html_url", "")}


async def _get(c: httpx.AsyncClient, url: str, **kw: Any) -> Any:
    r = await c.get(url, headers=HEADERS, **kw)
    if r.status_code == 403 and "rate limit" in r.text.lower():
        raise HubError("GitHub's search limit was reached. Wait a minute and try again.")
    if r.status_code == 404:
        raise HubError("Repository not found.")
    r.raise_for_status()
    return r.json()


async def search(q: str) -> List[Dict[str, Any]]:
    q = re.sub(r"[^\w\s.-]", " ", q or "").strip()[:80]
    out: Dict[str, Dict[str, Any]] = {}
    async with httpx.AsyncClient(timeout=20) as c:
        for topic in ("agent-skills", "claude-skills"):
            query = f"{q} in:name,description,readme topic:{topic}" if q else f"topic:{topic}"
            try:
                data = await _get(c, f"{API}/search/repositories", params={"q": query, "sort": "stars", "order": "desc", "per_page": 20})
            except httpx.HTTPError as e:
                raise HubError(f"Could not reach GitHub: {e.__class__.__name__}") from e
            for r in data.get("items", []):
                out.setdefault(r["full_name"], _repo_row(r))
    return sorted(out.values(), key=lambda r: -r["stars"])[:30]


async def featured() -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=20) as c:
        for f in FEATURED:
            try:
                row = _repo_row(await _get(c, f"{API}/repos/{f['full_name']}"))
                row["description"] = f["description"]
                out.append(row)
            except (HubError, httpx.HTTPError):
                out.append({"full_name": f["full_name"], "description": f["description"], "stars": 0, "license": "", "open": False, "url": ""})
    return out


def _scan_zip(zf: zipfile.ZipFile) -> List[Dict[str, str]]:
    skills: List[Dict[str, str]] = []
    for name in zf.namelist():
        parts = name.split("/")
        if parts[-1] != "SKILL.md" or len(parts) > 7 or any(p in (".git", "node_modules") for p in parts):
            continue
        info = zf.getinfo(name)
        if info.file_size > 200_000:
            continue
        meta, body = _frontmatter(zf.read(name).decode("utf-8", errors="replace"))
        prefix = "/".join(parts[:-1])
        label = meta.get("name") or (parts[-2] if len(parts) > 1 else "skill")
        desc = meta.get("description") or next((ln.strip() for ln in body.splitlines() if ln.strip()), "")
        skills.append({"path": prefix, "name": label, "description": desc[:220]})
        if len(skills) >= MAX_SKILLS:
            break
    return sorted(skills, key=lambda s: s["name"].lower())


async def open_repo(owner: str, repo: str) -> Dict[str, Any]:
    """Download a repository (if its licence allows) and list the skills inside it."""
    _check(owner, repo)
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as c:
        try:
            meta = await _get(c, f"{API}/repos/{owner}/{repo}")
        except httpx.HTTPError as e:
            raise HubError(f"Could not reach GitHub: {e.__class__.__name__}") from e
        row = _repo_row(meta)
        if not row["open"]:
            row["blocked"] = ("This repository has no open-source licence, so Atlas can't copy its skills. "
                              "Ask the author to add a licence, or write your own version.")
            row["skills"] = []
            return row
        if meta.get("size", 0) > 120_000:
            raise HubError("That repository is too large to download here.")
        path = _cache_path(owner, repo)
        total = 0
        try:
            async with c.stream("GET", f"https://codeload.github.com/{owner}/{repo}/zip/refs/heads/{meta.get('default_branch') or 'main'}") as r:
                r.raise_for_status()
                with open(path, "wb") as f:
                    async for chunk in r.aiter_bytes(65536):
                        total += len(chunk)
                        if total > MAX_ZIP:
                            raise HubError("That repository is too large to download here.")
                        f.write(chunk)
        except HubError:
            path.unlink(missing_ok=True)
            raise
        except httpx.HTTPError as e:
            path.unlink(missing_ok=True)
            raise HubError(f"Download failed: {e.__class__.__name__}") from e
    with zipfile.ZipFile(path) as zf:
        row["skills"] = _scan_zip(zf)
    return row


def preview(owner: str, repo: str, skill_path: str) -> str:
    _check(owner, repo)
    path = _cache_path(owner, repo)
    if not path.is_file():
        raise HubError("Open the repository again first.")
    with zipfile.ZipFile(path) as zf:
        name = f"{skill_path}/SKILL.md"
        if name not in zf.namelist():
            raise HubError("Skill not found.")
        return zf.read(name).decode("utf-8", errors="replace")[:6000]


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9._-]+", "-", s.lower()).strip("-.")[:60] or "skill"


def install(settings: Dict[str, Any], owner: str, repo: str, paths: List[str]) -> Dict[str, Any]:
    _check(owner, repo)
    cache = _cache_path(owner, repo)
    if not cache.is_file():
        raise HubError("Open the repository again first.")
    dest = folder(settings, "skills")
    dest.mkdir(parents=True, exist_ok=True)
    added: List[str] = []
    skipped = 0
    with zipfile.ZipFile(cache) as zf:
        names = zf.namelist()
        valid = {s["path"] for s in _scan_zip(zf)}
        for prefix in paths[:300]:
            if prefix not in valid:
                skipped += 1
                continue
            meta, _ = _frontmatter(zf.read(f"{prefix}/SKILL.md").decode("utf-8", errors="replace"))
            base = _slug(meta.get("name") or prefix.split("/")[-1])
            target, n = dest / base, 2
            while target.exists():
                target = dest / f"{base}-{n}"
                n += 1
            files = [n_ for n_ in names if n_.startswith(prefix + "/") and not n_.endswith("/")]
            files = [f for f in files if ".." not in f.split("/") and ((zf.getinfo(f).external_attr >> 16) & 0o170000) != stat.S_IFLNK]
            if len(files) > MAX_FILES_PER_SKILL or sum(zf.getinfo(f).file_size for f in files) > MAX_BYTES_PER_SKILL:
                skipped += 1
                continue
            for f in files:
                out = target / f[len(prefix) + 1:]
                if target.resolve() not in out.resolve().parents:
                    continue
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(zf.read(f))
                out.chmod(0o644)
            (target / ".atlas-source.json").write_text(json.dumps({"repo": f"{owner}/{repo}", "path": prefix, "url": f"https://github.com/{owner}/{repo}"}), encoding="utf-8")
            added.append(target.name)
    return {"added": len(added), "skipped": skipped, "names": added}
