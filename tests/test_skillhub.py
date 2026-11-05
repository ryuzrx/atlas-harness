import zipfile

import pytest

from atlas import skillhub as H


def _zip(path, files, link=None):
    with zipfile.ZipFile(path, "w") as z:
        for name, text in files.items():
            z.writestr(name, text)
        if link:
            info = zipfile.ZipInfo(link)
            info.external_attr = (0o120777 << 16)
            z.writestr(info, "/etc/passwd")


def test_install_from_cached_repo_is_safe(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_DATA_DIR", str(tmp_path / "data"))
    _zip(H._cache_path("o", "r"), {
        "r-main/skills/alpha/SKILL.md": "---\nname: alpha\ndescription: first\n---\nbody",
        "r-main/skills/alpha/notes.txt": "extra",
        "r-main/skills/beta/SKILL.md": "---\ndescription: second\n---\nbody",
    }, link="r-main/skills/alpha/evil")
    S = {"extensions.skills_dir": str(tmp_path / "skills")}
    got = H._scan_zip(zipfile.ZipFile(H._cache_path("o", "r")))
    assert [s["name"] for s in got] == ["alpha", "beta"]
    r = H.install(S, "o", "r", ["r-main/skills/alpha", "r-main/skills/beta", "r-main/nope"])
    assert r["added"] == 2 and r["skipped"] == 1
    assert (tmp_path / "skills" / "alpha" / "notes.txt").is_file()
    assert not (tmp_path / "skills" / "alpha" / "evil").exists()            # symlinks are never copied
    assert (tmp_path / "skills" / "alpha" / ".atlas-source.json").is_file()  # remembers where it came from
    assert H.install(S, "o", "r", ["r-main/skills/alpha"])["names"] == ["alpha-2"]  # never overwrites


def test_rejects_bad_names_and_unlicensed_are_not_open():
    with pytest.raises(H.HubError):
        H._check("../x", "y")
    assert "MIT" in H.OPEN_LICENSES and "" not in H.OPEN_LICENSES and "NOASSERTION" not in H.OPEN_LICENSES
