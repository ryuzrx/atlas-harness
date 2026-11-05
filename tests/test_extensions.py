import asyncio
import json

from atlas import extensions as E
from atlas import tools as T


def _settings(tmp_path, **extra):
    s = {"extensions.skills_dir": str(tmp_path / "skills"), "extensions.plugins_dir": str(tmp_path / "plugins"),
         "extensions.hooks_dir": str(tmp_path / "hooks")}
    s.update(extra)
    return s


def test_skills_from_folder_and_plugins(tmp_path):
    (tmp_path / "skills" / "demo").mkdir(parents=True)
    (tmp_path / "skills" / "demo" / "SKILL.md").write_text("---\nname: demo\ndescription: Does demos\n---\nStep one.")
    plug = tmp_path / "plugins" / "pl"
    (plug / "skills" / "inner").mkdir(parents=True)
    (plug / "skills" / "inner" / "SKILL.md").write_text("---\ndescription: inner\n---\nBody")
    (plug / "plugin.json").write_text('{"name": "pl"}')
    s = _settings(tmp_path)
    assert [x["name"] for x in E.list_skills(s)] == ["demo", "inner"]
    assert E.read_skill(s, "demo") == "Step one."
    s["extensions.disabled_plugins"] = ["pl"]
    assert [x["name"] for x in E.list_skills(s)] == ["demo"]
    assert "skill" in [t["name"] for t in T.tools_for(["read"], False, True)]
    assert "skill" not in [t["name"] for t in T.tools_for(["read"], False)]


def test_create_skill_validates_name(tmp_path):
    s = _settings(tmp_path)
    E.create_skill(s, "my-skill", "d", "body")
    for bad in ("../x", "Bad Name", "my-skill"):
        try:
            E.create_skill(s, bad, "", "")
        except ValueError:
            continue
        raise AssertionError(bad)


def test_hooks_are_opt_in_and_can_block(tmp_path):
    (tmp_path / "hooks").mkdir()
    (tmp_path / "hooks" / "hooks.json").write_text(json.dumps(
        {"PreToolUse": [{"matcher": "run_command", "command": "echo nope >&2; exit 2"}]}))
    off = _settings(tmp_path)
    assert asyncio.run(E.run_hooks("PreToolUse", "run_command", {}, None, tmp_path, off)) is None
    on = _settings(tmp_path, **{"extensions.hooks_enabled": True})
    assert asyncio.run(E.run_hooks("PreToolUse", "run_command", {}, None, tmp_path, on)) == "nope"
    assert asyncio.run(E.run_hooks("PreToolUse", "read_file", {}, None, tmp_path, on)) is None


def test_bundled_skill_packs_install_without_overwriting(tmp_path):
    s = _settings(tmp_path)
    packs = E.list_packs(s)
    assert len(packs) >= 5 and all(p["skills"] for p in packs)
    first = packs[0]
    assert E.install_pack(s, first["id"])["added"] == len(first["skills"])
    assert E.install_pack(s, first["id"])["added"] == 0           # second time: nothing overwritten
    assert E.list_packs(s)[0]["installed"] == len(first["skills"])
    try:
        E.install_pack(s, "../etc")
    except ValueError:
        return
    raise AssertionError("path escape accepted")
