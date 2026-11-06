"""Team and agent setup through the HTTP API, with no model requests."""
import pytest
from fastapi.testclient import TestClient

from atlas.api import S, create_app

@pytest.fixture(autouse=True)
def no_endpoint_health_processes(monkeypatch):
    from atlas.providers import ModelRouter
    async def no_health_checks(self):
        return []
    monkeypatch.setattr(ModelRouter, "health_all", no_health_checks)


HEADERS = {"x-atlas-token": "team-management-test"}


def models():
    return [
        {"provider_id": "local", "name": "small", "provider_kind": "ollama", "provider_name": "Local", "context_length": 8192, "size_bytes": 100, "capabilities": {"tools": True}},
        {"provider_id": "local", "name": "large", "provider_kind": "ollama", "provider_name": "Local", "context_length": 64000, "size_bytes": 1000, "capabilities": {"tools": True}},
        {"provider_id": "cli", "name": "default", "provider_kind": "codex_cli", "provider_name": "CLI", "capabilities": {"agentic": True}},
    ]


def set_models(monkeypatch, available):
    async def available_models():
        return available
    monkeypatch.setattr(S.router, "models", available_models)


def test_agent_automatic_assignment_uses_role_and_keeps_manual_choice(monkeypatch):
    with TestClient(create_app("team-management-test")) as client:
        set_models(monkeypatch, models())
        for role, expected in [("reviewer", "large"), ("researcher", "small"), ("engineer", "large")]:
            result = client.post("/api/agents", headers=HEADERS, json={"name": " Helper ", "role": role, "auto_assign_model": True})
            assert result.status_code == 200
            assert result.json()["model"] == expected
            assert result.json()["name"] == "Helper"
        result = client.post("/api/agents", headers=HEADERS, json={"name": "Manual", "role": "reviewer", "auto_assign_model": True, "provider_id": "chosen", "model": "custom"})
        assert result.json()["model"] == "custom"
        assert result.json()["provider_id"] == "chosen"


def test_agent_setup_without_endpoints_and_invalid_inputs(monkeypatch):
    with TestClient(create_app("team-management-test")) as client:
        set_models(monkeypatch, [])
        result = client.post("/api/agents", headers=HEADERS, json={"name": "Helper", "role": "engineer", "auto_assign_model": True})
        assert result.status_code == 200
        assert not result.json().get("model")
        assert client.post("/api/agents", headers=HEADERS, json={"name": "  ", "role": "engineer"}).status_code == 400
        assert client.post("/api/agents", headers=HEADERS, json={"name": "Helper", "role": "  "}).status_code == 400
        assert client.post("/api/agents", headers=HEADERS, json={"name": "Helper", "role": "engineer", "team_id": "missing"}).status_code == 404


def test_team_auto_setup_ignores_stale_routing_and_preserves_assigned_agents(monkeypatch):
    with TestClient(create_app("team-management-test")) as client:
        set_models(monkeypatch, models())
        client.patch("/api/settings", headers=HEADERS, json={"models.routing": {"reasoning": {"provider_id": "old", "model": "offline"}}})
        result = client.post("/api/teams", headers=HEADERS, json={"template": "engineering", "auto_assign_models": True})
        assert result.status_code == 200
        team = result.json()
        agents = client.get(f"/api/agents?team_id={team['id']}", headers=HEADERS).json()
        assert agents
        assert all(agent["model"] in ("small", "large") for agent in agents)
        original = {a["id"]: (a["provider_id"], a["model"]) for a in agents}
        lead = next(a for a in agents if a["is_lead"])
        client.patch(f"/api/agents/{lead['id']}", headers=HEADERS, json={"provider_id": None, "model": None})
        assigned = client.post(f"/api/teams/{team['id']}/agents/auto-assign", headers=HEADERS, json={}).json()["assigned"]
        assert [a["id"] for a in assigned] == [lead["id"]]
        after = client.get(f"/api/agents?team_id={team['id']}", headers=HEADERS).json()
        assert all((a["provider_id"], a["model"]) == original[a["id"]] for a in after)


def test_explicit_team_routing_is_preserved(monkeypatch):
    with TestClient(create_app("team-management-test")) as client:
        set_models(monkeypatch, models())
        result = client.post("/api/teams", headers=HEADERS, json={"template": "engineering", "routing": {"reasoning": {"provider_id": "chosen", "model": "custom"}}})
        assert result.status_code == 200
        team = result.json()
        agents = client.get(f"/api/agents?team_id={team['id']}", headers=HEADERS).json()
        assert next(a for a in agents if a["is_lead"])["model"] == "custom"
