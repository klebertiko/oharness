from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_get_default_bundle():
    r = client.get("/bundles/default")
    assert r.status_code == 200
    assert r.json()["manifest"]["id"] == "oharness.default.agile"


def test_validate_endpoint_ok():
    bundle = client.get("/bundles/default").json()
    r = client.post("/bundles/validate", json=bundle)
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json()["errors"] == []


def test_validate_endpoint_invalid():
    r = client.post("/bundles/validate", json={"bad": True})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert body["errors"]


def test_mock_endpoint_default():
    bundle = client.get("/bundles/default").json()
    r = client.post("/bundles/mock", json=bundle)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    # 8 agent roles + the HITL merge-authority node (SEC -> HITL edge).
    assert len(body["steps"]) == 9
    assert all(step["status"] == "planned" for step in body["steps"])


def test_mock_endpoint_invalid():
    r = client.post("/bundles/mock", json={"bad": True})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert body["steps"] == []
    assert body["errors"]
