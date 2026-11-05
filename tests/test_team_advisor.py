from atlas import team_advisor as T


def test_keyword_fallback_ranks_and_defaults():
    assert T.heuristic("build a mobile app and test it before shipping")[0] == "engineering"
    assert "qa" in T.heuristic("make sure it is secure and tested")
    assert T.heuristic("hello") == ["engineering"]


def test_reply_parsing_ignores_unknown_ids_and_chatter():
    valid = ["engineering", "design", "qa"]
    assert T.parse_reply('Sure! {"teams": ["design", "bogus", "qa"], "reason": "UI work"}', valid) == (["design", "qa"], "UI work")
    assert T.parse_reply("no json here", valid) is None
    assert T.parse_reply('{"teams": ["bogus"]}', valid) is None
