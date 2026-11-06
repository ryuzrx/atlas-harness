"""Workspace boundaries, command policy, sandboxing and credential storage."""
from __future__ import annotations

import fnmatch
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple


class PermissionDenied(Exception):
    pass


SECRET_PATTERNS = [
    ".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx", "id_rsa*", "id_ed25519*", "id_ecdsa*",
    ".netrc", ".npmrc", ".pypirc", "credentials", "credentials.json", "*.keychain*", "secrets.*",
]


def is_secret_file(path: Path) -> bool:
    name = path.name
    if name in (".env.example", ".env.sample", ".env.template"):
        return False
    return any(fnmatch.fnmatch(name, p) for p in SECRET_PATTERNS)


def resolve_in_workspace(root: Path, rel: str, *, block_secrets: bool = True) -> Path:
    """Resolve a path an agent asked for. Reject anything outside `root`, including symlink escapes."""
    root = root.resolve()
    if not rel:
        rel = "."
    candidate = Path(rel).expanduser()
    if not candidate.is_absolute():
        candidate = root / candidate
    resolved = candidate.resolve()
    if resolved != root and root not in resolved.parents:
        raise PermissionDenied(f"Path '{rel}' is outside the workspace boundary.")
    parts = set(resolved.relative_to(root).parts)
    if ".git" in parts:
        raise PermissionDenied("Direct access to .git internals is not allowed; use git tools.")
    if block_secrets and is_secret_file(resolved):
        raise PermissionDenied(f"'{resolved.name}' looks like a credential file and is blocked by policy.")
    return resolved


# --- commands ---------------------------------------------------------------

DENY_PATTERNS = [
    r"(^|[;&|]\s*)sudo\b", r"\bsu\s", r"\bmkfs\b", r"\bdd\s+if=", r":\(\)\s*\{", r"\bshutdown\b", r"\breboot\b",
    r"rm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+(/|~|\$HOME)(\s|$)", r"\bchmod\s+-R\s+777\s+/", r"\blaunchctl\b",
    r"\bsecurity\s+(find|dump|delete)", r"\bdefaults\s+write\b", r"\bcsrutil\b",
]
# Writing output into an absolute path, except the harmless /dev/null and temp folders
# ("cmd 2>/dev/null" is everywhere in agent commands and must not need approval).
REDIRECT_TO_SYSTEM = r">\s*/(?!dev/null\b|tmp/|private/tmp/|var/folders/)"
DESTRUCTIVE_PATTERNS = [
    r"\brm\s", r"\bgit\s+(push|reset\s+--hard|clean|checkout\s+--|rebase|branch\s+-D|stash\s+drop)",
    r"\bcurl\b.*\|\s*(sh|bash|zsh)", r"\bwget\b.*\|\s*(sh|bash)", r"\bnpm\s+publish\b", r"\bpip\s+install\b",
    r"\bnpm\s+(i|install)\b", r"\bmv\s", REDIRECT_TO_SYSTEM, r"\bchmod\b", r"\bchown\b", r"\bkill(all)?\b",
]


# Auto-approve still stops for these: they delete data, rewrite history, publish, or change permissions.
# Everyday build commands (npm install, pip install, mv, test runners...) are approved automatically.
CRITICAL_PATTERNS = [
    r"\brm\s", r"\bgit\s+(push|reset\s+--hard|clean|checkout\s+--|rebase|branch\s+-D|stash\s+drop)",
    r"\bcurl\b.*\|\s*(sh|bash|zsh)", r"\bwget\b.*\|\s*(sh|bash)", r"\bnpm\s+publish\b",
    REDIRECT_TO_SYSTEM, r"\bchmod\b", r"\bchown\b", r"\bkill(all)?\b",
]


def normalize_command(cmd: str) -> str:
    """Whitespace-insensitive form used for exact "always allow" matches."""
    return " ".join(str(cmd or "").split())


def classify_command(cmd: str, policy: str, allowlist: List[str], auto_approve: bool = False,
                     always: Optional[List[str]] = None) -> Tuple[str, str]:
    """Return (decision, reason). decision in {'deny','ask','allow'}."""
    stripped = cmd.strip()
    for pat in DENY_PATTERNS:
        if re.search(pat, stripped):
            return "deny", f"Command matches a blocked pattern ({pat})."
    # the user chose "Always allow" for exactly this command: honor it (blocked commands stay blocked)
    if always and normalize_command(stripped) in {normalize_command(a) for a in always}:
        return "allow", "You chose to always allow this command."
    for pat in (CRITICAL_PATTERNS if auto_approve else DESTRUCTIVE_PATTERNS):
        if re.search(pat, stripped):
            return "ask", "Potentially destructive command requires confirmation."
    if auto_approve:
        return "allow", "Auto-approve is on for this chat."
    if policy == "auto":
        return "allow", "Auto policy."
    # allowlisted only when every pipeline segment starts with an allowlisted prefix
    segments = [s.strip() for s in re.split(r"&&|\|\||;|\|", stripped) if s.strip()]
    def ok(seg: str) -> bool:
        return any(seg == a or seg.startswith(a + " ") for a in allowlist)
    if segments and all(ok(s) for s in segments):
        return "allow", "Allowlisted command."
    if policy == "allowlist":
        return "deny", "Command is not on the allowlist."
    return "ask", "Command is not allowlisted; approval required."


SAFE_ENV_KEYS = {"PATH", "HOME", "LANG", "LC_ALL", "TERM", "SHELL", "USER", "TMPDIR", "PYTHONPATH",
                 "NODE_OPTIONS", "GOPATH", "CARGO_HOME", "RUSTUP_HOME", "JAVA_HOME"}


def scrubbed_env(extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """Environment for agent commands: no API keys or tokens leak into tool processes."""
    env = {k: v for k, v in os.environ.items() if k in SAFE_ENV_KEYS}
    env.setdefault("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
    extras = ["/opt/homebrew/bin", "/usr/local/bin", str(Path.home() / ".local/bin")]
    env["PATH"] = ":".join([env["PATH"]] + [p for p in extras if p not in env["PATH"]])
    if extra:
        env.update(extra)
    return env


def sandbox_wrap(argv: List[str], workspace: Path, allow_network: bool, extra_write: Optional[List[Path]] = None) -> List[str]:
    """Wrap a command with macOS sandbox-exec so writes outside the workspace fail. No admin rights needed."""
    if sys.platform != "darwin" or not shutil.which("sandbox-exec"):
        return argv
    writable = [workspace.resolve(), Path("/private/tmp"), Path("/private/var/folders"), Path("/dev")]
    writable += [p.resolve() for p in (extra_write or [])]
    for cache in (".npm", ".cache", "Library/Caches"):
        writable.append(Path.home() / cache)
    rules = " ".join(f'(subpath "{_esc(str(p))}")' for p in writable)
    profile = f"(version 1)(allow default)(deny file-write* (require-not (require-any {rules})))"
    if not allow_network:
        profile += '(deny network-outbound (require-not (remote ip "localhost:*")))'
    return ["sandbox-exec", "-p", profile] + argv


def _esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def shell_argv(cmd: str) -> List[str]:
    return ["/bin/zsh", "-c", cmd] if Path("/bin/zsh").exists() else ["/bin/sh", "-c", cmd]


# --- credentials (macOS Keychain; user keychain, no admin rights) -------------

KEYCHAIN_SERVICE = "ATLAS Harness"


def store_secret(account: str, secret: str) -> None:
    if sys.platform == "darwin" and shutil.which("security"):
        subprocess.run(["security", "add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", account, "-w", secret],
                       check=True, capture_output=True)
        return
    raise RuntimeError("Secure credential storage is only implemented for macOS Keychain.")


def load_secret(account: str) -> Optional[str]:
    if sys.platform == "darwin" and shutil.which("security"):
        r = subprocess.run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
                           capture_output=True, text=True)
        if r.returncode == 0:
            return r.stdout.strip()
    return None


def delete_secret(account: str) -> None:
    if sys.platform == "darwin" and shutil.which("security"):
        subprocess.run(["security", "delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account],
                       capture_output=True)


def redact(text: str) -> str:
    text = re.sub(r"(sk-[A-Za-z0-9_\-]{8})[A-Za-z0-9_\-]{8,}", r"\1…", text)
    text = re.sub(r"(sk-ant-[A-Za-z0-9_\-]{6})[A-Za-z0-9_\-]{8,}", r"\1…", text)
    return text


def quote(s: str) -> str:
    return shlex.quote(s)
