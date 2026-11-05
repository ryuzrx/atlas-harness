"""Suggest which preset teams someone needs from a plain-language description.

A connected model does the judging; keyword scoring is the fallback so this always works, even offline."""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Tuple

KEYWORDS: Dict[str, List[str]] = {
    "engineering": ["code", "coding", "app", "apps", "build", "website", "web", "software", "program", "develop", "feature", "bug", "backend",
                    "frontend", "api", "game", "script", "refactor", "project"],
    "research": ["research", "analy", "investigate", "learn", "docs", "documentation", "compare", "explore", "study", "summar", "evaluate", "options", "read"],
    "design": ["design", "ui", "ux", "interface", "landing", "brand", "layout", "figma", "style", "look", "visual", "mockup"],
    "qa": ["test", "testing", "quality", "security", "verify", "reliable", "review", "audit", "performance", "regression", "bug"],
    "devops": ["deploy", "release", "ci", "cd", "infrastructure", "docker", "server", "pipeline", "hosting", "cloud", "ship", "build system", "monitor"],
}


def heuristic(need: str) -> List[str]:
    text = need.lower()
    scores = {k: sum(1 for w in words if re.search(r"\b" + re.escape(w), text)) for k, words in KEYWORDS.items()}
    ranked = [k for k, v in sorted(scores.items(), key=lambda kv: -kv[1]) if v > 0]
    return ranked[:3] or ["engineering"]


def build_messages(need: str, templates: Dict[str, Dict[str, Any]]) -> List[Dict[str, str]]:
    menu = "\n".join(f'- "{k}": {v["name"]}. {v["description"]}' for k, v in templates.items())
    system = ("You help someone choose preset AI agent teams. Pick the 1 to 3 teams that best fit what they want to do. "
              "Only use the ids listed. Reply with JSON only, no other text: "
              '{"teams": ["id", ...], "reason": "one short plain-English sentence"}')
    return [{"role": "system", "content": system}, {"role": "user", "content": f"Teams:\n{menu}\n\nWhat I want to do:\n{need}"}]


def parse_reply(text: str, valid: List[str]) -> Optional[Tuple[List[str], str]]:
    a, b = text.find("{"), text.rfind("}")
    if a < 0 or b <= a:
        return None
    try:
        data = json.loads(text[a:b + 1])
    except ValueError:
        return None
    ids = [t for t in (data.get("teams") or []) if isinstance(t, str) and t in valid]
    if not ids:
        return None
    return list(dict.fromkeys(ids))[:3], str(data.get("reason") or "")[:300]
