import asyncio

import pytest
from fastapi.testclient import TestClient

from atlas import tools
from atlas.tools import ToolError

TOKEN = "test-token"
HEADERS = {"x-atlas-token": TOKEN}


def test_web_search_requires_a_saved_key(monkeypatch):
    monkeypatch.setattr(tools, "load_secret", lambda _: None)
    with pytest.raises(ToolError, match="Settings → Integrations"):
        asyncio.run(tools.t_web_search(None, "current model releases"))


def test_web_search_returns_bounded_clickable_sources(monkeypatch):
    monkeypatch.setattr(tools, "load_secret", lambda _: "test-key")
    calls = {}

    class Response:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"results": [
                {"title": "Model release", "url": "https://example.com/release", "content": "A new model was released."},
                {"title": "Unsafe URL", "url": "javascript:alert(1)", "content": "ignored"},
            ]}

    class Client:
        def __init__(self, **kwargs):
            calls["timeout"] = kwargs["timeout"]

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, url, *, headers, json):
            calls.update(url=url, headers=headers, body=json)
            return Response()

    monkeypatch.setattr(tools.httpx, "AsyncClient", Client)
    result = asyncio.run(tools.t_web_search(None, "current model releases", max_results=99))
    assert "Model release\nhttps://example.com/release\nA new model was released." in result
    assert "javascript:" not in result
    assert calls["url"] == "https://api.tavily.com/search"
    assert calls["body"]["max_results"] == 10
    assert calls["headers"]["Authorization"] == "Bearer test-key"
    assert "api_key" not in calls["body"]


def test_web_search_rejects_empty_or_oversized_queries():
    with pytest.raises(ToolError, match="1–500"):
        asyncio.run(tools.t_web_search(None, ""))
    with pytest.raises(ToolError, match="1–500"):
        asyncio.run(tools.t_web_search(None, "x" * 501))


def test_web_search_credential_api_never_returns_the_key(monkeypatch):
    from atlas import api

    saved = {}
    monkeypatch.setattr(api, "store_secret", lambda account, value: saved.update({account: value}))
    monkeypatch.setattr(api, "load_secret", lambda account: saved.get(account))
    monkeypatch.setattr(api, "delete_secret", lambda account: saved.pop(account, None))
    with TestClient(api.create_app(TOKEN)) as client:
        path = "/api/integrations/web-search"
        assert client.get(path, headers=HEADERS).json() == {"provider": "Tavily", "connected": False}
        connected = client.put(path, json={"api_key": "private-test-key"}, headers=HEADERS)
        assert connected.status_code == 200 and connected.json()["connected"] is True
        assert "private-test-key" not in client.get("/api/settings", headers=HEADERS).text
        assert client.get(path, headers=HEADERS).json()["connected"] is True
        assert client.delete(path, headers=HEADERS).json()["connected"] is False
        assert saved == {}
