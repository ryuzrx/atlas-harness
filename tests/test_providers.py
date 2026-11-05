"""Provider catalog and the OpenAI-compatible adapter, against a real local HTTP server."""
import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from atlas.providers import KINDS
from atlas.providers.catalog import OLLAMA_LIBRARY, PROVIDER_PRESETS
from atlas.providers.openai_compat import OpenAICompatProvider


def test_catalog_is_consistent():
    ids = [p["id"] for p in PROVIDER_PRESETS]
    assert len(ids) == len(set(ids))
    for p in PROVIDER_PRESETS:
        assert p["kind"] in KINDS, p
        assert p["category"] in ("local", "cloud", "cli"), p
        if p["category"] == "cloud" and p["id"] != "custom":
            assert p["needs_key"] and p["key_url"].startswith("https://"), p
            if p["kind"] == "openai_compat":
                assert p["base_url"].startswith("https://"), p
    names = [m["name"] for m in OLLAMA_LIBRARY]
    assert len(names) == len(set(names)) and all(":" in n for n in names)
    assert len([p for p in PROVIDER_PRESETS if p["category"] == "cloud"]) >= 20


def prov(base_url, config=None, secret=None):
    return OpenAICompatProvider({"id": "p1", "name": "T", "base_url": base_url, "config": config or {}}, secret)


def test_api_base_keeps_explicit_paths():
    assert prov("http://127.0.0.1:8080").api_base == "http://127.0.0.1:8080/v1"
    assert prov("http://127.0.0.1:8080/").api_base == "http://127.0.0.1:8080/v1"
    assert prov("http://127.0.0.1:1234/v1").api_base == "http://127.0.0.1:1234/v1"
    assert prov("https://generativelanguage.googleapis.com/v1beta/openai/").api_base == "https://generativelanguage.googleapis.com/v1beta/openai"
    assert prov("https://api.z.ai/api/paas/v4").api_base == "https://api.z.ai/api/paas/v4"
    assert prov("https://api.deepinfra.com/v1/openai").api_base == "https://api.deepinfra.com/v1/openai"


class _Handler(BaseHTTPRequestHandler):
    seen = []

    def log_message(self, *a):
        pass

    def do_GET(self):
        _Handler.seen.append(("GET", self.path, dict(self.headers)))
        body = json.dumps({"data": [{"id": "models/zeta"}, {"id": "models/alpha"}]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        req = json.loads(self.rfile.read(n))
        _Handler.seen.append(("POST", self.path, dict(self.headers), req))
        self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
        for piece in ("Hel", "lo"):
            self.wfile.write(f"data: {json.dumps({'choices': [{'delta': {'content': piece}}]})}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")


def test_openai_compat_against_local_server():
    srv = HTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}/custom/openai"
    p = prov(base, {"headers": {"X-Title": "ATLAS Harness", "Authorization": "ignored"}, "strip_model_prefix": "models/"}, secret="sk-test")
    try:
        models = asyncio.run(p.list_models())
        assert [m.name for m in models] == ["alpha", "zeta"]          # prefix stripped, sorted
        toks = []

        async def on_token(t):
            toks.append(t)
        res = asyncio.run(p.chat("alpha", [{"role": "user", "content": "hi"}], on_token=on_token))
        assert res.text == "Hello" and toks == ["Hel", "lo"]
        get, post = _Handler.seen[0], _Handler.seen[1]
        assert get[1] == "/custom/openai/models" and post[1] == "/custom/openai/chat/completions"
        hdrs = {k.lower(): v for k, v in post[2].items()}
        assert hdrs["authorization"] == "Bearer sk-test" and hdrs["x-title"] == "ATLAS Harness"
        assert post[3]["model"] == "alpha" and post[3]["stream"] is True
    finally:
        srv.shutdown()


def test_fixed_model_list_provider():
    p = prov("https://api.perplexity.ai", {"no_model_list": True, "exact_base_url": True, "extra_models": ["sonar", "sonar-pro"]})
    assert [m.name for m in asyncio.run(p.list_models())] == ["sonar", "sonar-pro"]
    assert asyncio.run(p.health())["ok"]
    assert p.api_base == "https://api.perplexity.ai"  # its endpoint has no /v1 (verified: /v1 returns 404)


class _AuthHandler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer good":
            self.send_response(401); self.end_headers(); return
        body = json.dumps({"data": [{"id": f"m{i}"} for i in range(30)]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)


def test_test_config_checks_key_without_saving():
    from fastapi.testclient import TestClient
    from atlas.api import create_app
    srv = HTTPServer(("127.0.0.1", 0), _AuthHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_address[1]}/v1"
    H = {"x-atlas-token": "t"}
    try:
        with TestClient(create_app("t")) as c:
            before = len(c.get("/api/providers", headers=H).json())
            ok = c.post("/api/providers/test-config", json={"kind": "openai_compat", "base_url": url, "api_key": "good"}, headers=H).json()
            assert ok["ok"] and ok["count"] == 30 and len(ok["models"]) == 12
            bad = c.post("/api/providers/test-config", json={"kind": "openai_compat", "base_url": url, "api_key": "nope"}, headers=H).json()
            assert not bad["ok"] and "Unauthorized" in bad["error"]
            assert c.post("/api/providers/test-config", json={"kind": "nope"}, headers=H).status_code == 400
            assert len(c.get("/api/providers", headers=H).json()) == before   # nothing was saved
    finally:
        srv.shutdown()
