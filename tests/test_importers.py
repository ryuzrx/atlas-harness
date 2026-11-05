"""Importing project folders from other AI tools, against fake tool files in a temporary home."""
import json
import sqlite3

from fastapi.testclient import TestClient

from atlas import importers

H = {"x-atlas-token": "t"}


def make_home(tmp_path):
    home = tmp_path / "home"
    proj = {n: (home / "code" / n) for n in ("alpha", "beta", "gamma", "delta", "spaced name")}
    for p in proj.values():
        p.mkdir(parents=True)
    (proj["alpha"] / ".git").mkdir()
    # Claude Code: ~/.claude.json + a session log with cwd
    (home / ".claude.json").write_text(json.dumps({"projects": {str(proj["alpha"]): {}, str(home): {}, "/does/not/exist": {}}}))
    d = home / ".claude" / "projects" / "-x"
    d.mkdir(parents=True)
    (d / "s.jsonl").write_text(json.dumps({"type": "summary"}) + "\n" + json.dumps({"cwd": str(proj["beta"])}) + "\n")
    # Codex: config.toml projects + a session_meta line
    (home / ".codex" / "sessions" / "2026").mkdir(parents=True)
    (home / ".codex" / "config.toml").write_text(f'model = "x"\n[projects."{proj["alpha"]}"]\ntrust_level = "trusted"\n')
    (home / ".codex" / "sessions" / "2026" / "r.jsonl").write_text(json.dumps({"type": "session_meta", "payload": {"cwd": str(proj["gamma"])}}) + "\n")
    # OpenCode: sqlite db
    db = home / ".local" / "share" / "opencode"
    db.mkdir(parents=True)
    con = sqlite3.connect(db / "opencode.db")
    con.execute("CREATE TABLE project (id TEXT, worktree TEXT, time_updated INTEGER)")
    con.execute("INSERT INTO project VALUES ('p', ?, 1793800000000)", (str(proj["delta"]),))
    con.execute("CREATE TABLE session (id TEXT, directory TEXT)")
    con.execute("INSERT INTO session VALUES ('s', ?)", (str(home / "Library" / "Caches"),))   # app data: ignored
    con.commit(); con.close()
    # Cursor (VS Code format), URL-encoded path
    ws = home / "Library" / "Application Support" / "Cursor" / "User" / "workspaceStorage" / "abc"
    ws.mkdir(parents=True)
    (ws / "workspace.json").write_text(json.dumps({"folder": "file://" + str(proj["spaced name"]).replace(" ", "%20")}))
    return home, proj


def test_scan_finds_folders_across_tools(tmp_path, monkeypatch):
    home, proj = make_home(tmp_path)
    monkeypatch.setenv("ATLAS_IMPORT_HOME", str(home))
    r = importers.scan([str(proj["beta"])])
    by = {f["name"]: f for f in r["folders"]}
    assert set(by) == {"alpha", "beta", "gamma", "delta", "spaced name"}     # home, missing and app-data paths skipped
    assert set(by["alpha"]["sources"]) == {"Claude Code", "Codex CLI"} and by["alpha"]["is_repo"]
    assert by["beta"]["added"] and not by["gamma"]["added"]
    assert by["delta"]["sources"] == ["OpenCode"] and by["delta"]["last_used"] == 1793800000.0
    assert by["spaced name"]["sources"] == ["Cursor"]
    counts = {t["id"]: t["count"] for t in r["tools"]}
    assert counts["claude_code"] == 2 and counts["codex"] == 2 and counts["opencode"] == 1 and counts["vscode"] == 0


def test_import_endpoint_adds_and_skips(tmp_path, monkeypatch):
    home, proj = make_home(tmp_path)
    monkeypatch.setenv("ATLAS_IMPORT_HOME", str(home))
    from atlas.api import create_app
    with TestClient(create_app("t")) as c:
        scan = c.get("/api/import/scan", headers=H).json()
        paths = [f["path"] for f in scan["folders"]]
        r = c.post("/api/import/projects", json={"paths": paths + [str(home)]}, headers=H).json()
        assert len(r["added"]) == 5 and {s["reason"] for s in r["skipped"]} == {"not a folder"}
        again = c.post("/api/import/projects", json={"paths": paths[:1]}, headers=H).json()
        assert again["added"] == [] and again["skipped"][0]["reason"] == "already added"
        assert all(f["added"] for f in c.get("/api/import/scan", headers=H).json()["folders"])


def test_skills_found_from_claude_and_codex(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_IMPORT_HOME", str(tmp_path))
    (tmp_path / ".claude/skills/caveman").mkdir(parents=True)
    (tmp_path / ".claude/skills/caveman/SKILL.md").write_text("---\ndescription: terse\n---\nx")
    (tmp_path / ".codex/skills/pack/inner").mkdir(parents=True)
    (tmp_path / ".codex/skills/pack/inner/SKILL.md").write_text("---\nname: inner-skill\ndescription: d\n---\nx")
    (tmp_path / ".claude/skills/.hidden").mkdir(parents=True)
    (tmp_path / ".claude/skills/.hidden/SKILL.md").write_text("x")
    from atlas import importers
    found = {(s["name"], s["source"]) for s in importers.skills()}
    assert found == {("caveman", "Claude Code"), ("inner-skill", "Codex CLI")}
