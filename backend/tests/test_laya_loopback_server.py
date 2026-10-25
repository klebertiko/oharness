"""
EXPERIMENTAL — Laya decision-node loopback process (ADR-0005, spike).

Unit-level HTTP contract test for `backend/laya_loopback/server.py`. Does
NOT import or require the real `laya` package / model weights — that
dependency is intentionally excluded from `backend/requirements.txt` (see
`laya_loopback/requirements.txt`'s own docstring), so these tests inject a
fake `Router`-shaped object instead. What's being proven here is the HTTP
contract (`/health`, `/predict` success/failure shapes, honest errors —
never a fabricated result), not Laya's own model behaviour.
"""
from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request

import pytest

from laya_loopback.server import _Handler, HTTPServer


class _FakeRouter:
    def __init__(self, result: dict | None = None, raise_exc: Exception | None = None) -> None:
        self._result = result
        self._raise_exc = raise_exc
        self.calls: list[tuple[dict, dict]] = []

    def predict(self, state: dict, questions: dict) -> dict:
        self.calls.append((state, questions))
        if self._raise_exc is not None:
            raise self._raise_exc
        return self._result if self._result is not None else {"answers": {}}


@pytest.fixture
def server(monkeypatch: pytest.MonkeyPatch):
    fake = _FakeRouter(result={"answers": {"needs_review": {"noul": 0.2}}})
    monkeypatch.setattr(_Handler, "router", fake)
    httpd = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd, fake
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


def _url(httpd: HTTPServer, path: str) -> str:
    port = httpd.server_address[1]
    return f"http://127.0.0.1:{port}{path}"


def test_health_does_not_touch_the_router(server) -> None:
    httpd, fake = server
    with urllib.request.urlopen(_url(httpd, "/health"), timeout=5) as resp:  # nosemgrep: opengrep-rules.python.lang.security.audit.dynamic-urllib-use-detected -- fixed http://127.0.0.1 test server
        assert resp.status == 200
        assert json.loads(resp.read()) == {"status": "ok"}
    assert fake.calls == []


def test_predict_returns_schema_version_and_latency_ms(server) -> None:
    httpd, fake = server
    req = urllib.request.Request(
        _url(httpd, "/predict"),
        data=json.dumps({"state": {"output": "hello"}, "questions": {"q": {"type": "noul"}}}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:  # nosemgrep: opengrep-rules.python.lang.security.audit.dynamic-urllib-use-detected -- fixed http://127.0.0.1 test server
        assert resp.status == 200
        payload = json.loads(resp.read())
    assert payload["schema_version"] == "oharness-decision-node-v1"
    assert payload["model_result"] == {"answers": {"needs_review": {"noul": 0.2}}}
    assert isinstance(payload["latency_ms"], (int, float))
    assert fake.calls == [({"output": "hello"}, {"q": {"type": "noul"}})]


def test_predict_failure_is_an_honest_500_never_a_fabricated_result(monkeypatch: pytest.MonkeyPatch, server) -> None:
    httpd, _fake = server
    monkeypatch.setattr(_Handler, "router", _FakeRouter(raise_exc=RuntimeError("model blew up")))
    req = urllib.request.Request(
        _url(httpd, "/predict"),
        data=json.dumps({"state": {}, "questions": {}}).encode(),
        method="POST",
    )
    with pytest.raises(urllib.error.HTTPError) as exc_info:
        urllib.request.urlopen(req, timeout=5)  # nosemgrep: opengrep-rules.python.lang.security.audit.dynamic-urllib-use-detected -- fixed http://127.0.0.1 test server
    assert exc_info.value.code == 500
    payload = json.loads(exc_info.value.read())
    assert "model blew up" in payload["error"]


def test_unknown_path_is_404(server) -> None:
    httpd, _fake = server
    with pytest.raises(urllib.error.HTTPError) as exc_info:
        urllib.request.urlopen(_url(httpd, "/nope"), timeout=5)  # nosemgrep: opengrep-rules.python.lang.security.audit.dynamic-urllib-use-detected -- fixed http://127.0.0.1 test server
    assert exc_info.value.code == 404
