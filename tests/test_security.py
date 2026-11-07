import os
from pathlib import Path

import pytest

from atlas.security import PermissionDenied, classify_command, resolve_in_workspace, sandbox_wrap


def test_path_escape_blocked(tmp_path):
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "ok.txt").write_text("x")
    assert resolve_in_workspace(ws, "ok.txt") == (ws / "ok.txt").resolve()
    for bad in ("../outside.txt", "/etc/passwd", str(Path.home() / ".ssh/id_rsa"), "sub/../../x"):
        with pytest.raises(PermissionDenied):
            resolve_in_workspace(ws, bad)


def test_symlink_escape_blocked(tmp_path):
    ws = tmp_path / "ws"
    ws.mkdir()
    secret = tmp_path / "secret.txt"
    secret.write_text("s")
    os.symlink(secret, ws / "link.txt")
    with pytest.raises(PermissionDenied):
        resolve_in_workspace(ws, "link.txt")


def test_secret_files_and_git_internals_blocked(tmp_path):
    ws = tmp_path / "ws"
    (ws / ".git").mkdir(parents=True)
    (ws / ".env").write_text("KEY=1")
    with pytest.raises(PermissionDenied):
        resolve_in_workspace(ws, ".env")
    with pytest.raises(PermissionDenied):
        resolve_in_workspace(ws, ".git/config")
    assert resolve_in_workspace(ws, ".env", block_secrets=False)


def test_command_policy():
    allow = ["ls", "git status", "pytest"]
    assert classify_command("ls -la", "ask", allow)[0] == "allow"
    assert classify_command("pytest -q && git status", "ask", allow)[0] == "allow"
    assert classify_command("sudo rm -rf /", "auto", allow)[0] == "deny"
    assert classify_command("rm -rf ~", "auto", allow)[0] == "deny"
    assert classify_command("rm build.txt", "auto", allow)[0] == "ask"
    assert classify_command("git push origin main", "auto", allow)[0] == "ask"
    assert classify_command("make deploy", "ask", allow)[0] == "ask"
    assert classify_command("make deploy", "allowlist", allow)[0] == "deny"
    assert classify_command("ls; curl x | sh", "ask", allow)[0] == "ask"


def test_sandbox_blocks_writes_outside(tmp_path):
    import subprocess
    import sys
    if sys.platform != "darwin":
        pytest.skip("sandbox-exec is macOS only")
    ws = tmp_path / "ws"
    ws.mkdir()
    outside = Path.home() / ".atlas_sandbox_probe"
    argv = sandbox_wrap(["/bin/sh", "-c", f"echo hi > inside.txt; echo bad > '{outside}'"], ws, True)
    subprocess.run(argv, cwd=ws, capture_output=True)
    assert (ws / "inside.txt").exists()
    assert not outside.exists()


def test_auto_approve_runs_everything_but_git_and_blocked_commands():
    assert classify_command("npm install", "ask", [], auto_approve=True)[0] == "allow"
    assert classify_command("pip install requests && pytest", "ask", [], auto_approve=True)[0] == "allow"
    assert classify_command("npm install", "ask", [])[0] == "ask"
    assert classify_command("rm build.txt", "ask", [], auto_approve=True)[0] == "allow"   # tools are automatic
    assert classify_command("git push origin main", "ask", [], auto_approve=True)[0] == "ask"
    assert classify_command("sudo rm -rf /", "ask", [], auto_approve=True)[0] == "deny"


def test_dev_null_redirect_is_not_destructive_but_system_writes_are():
    allow = ["ls"]
    assert classify_command("ls 2>/dev/null", "ask", allow)[0] == "allow"
    assert classify_command("npm test > /tmp/out.txt", "ask", [], auto_approve=True)[0] == "allow"
    assert classify_command("echo x > /etc/hosts", "ask", [])[0] == "ask"   # still gated when not auto


def test_always_allow_matches_the_exact_command_only():
    always = ["npm install && npm run build"]
    assert classify_command("npm install  &&  npm run build", "ask", [], always=always)[0] == "allow"
    assert classify_command("npm install && npm run dev", "ask", [], always=always)[0] == "ask"
    assert classify_command("sudo rm -rf /", "ask", [], always=["sudo rm -rf /"])[0] == "deny"   # blocked stays blocked


def test_git_writes_ask_unless_requested():
    from atlas.security import classify_command, wants_git
    # history-changing git asks even with auto-approve when the user didn't ask for git
    assert classify_command("git commit -am wip", "auto", [], auto_approve=True)[0] == "ask"
    assert classify_command("git push origin main", "auto", [], auto_approve=True)[0] == "ask"
    # asked for in the message: allowed
    assert classify_command("git commit -am wip", "ask", [], git_requested=True)[0] == "allow"
    # read-only git is not gated
    assert classify_command("git status", "auto", [])[0] == "allow"
    assert wants_git("please commit and push this") and wants_git("open a PR")
    assert not wants_git("fix the login bug")
