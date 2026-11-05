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
