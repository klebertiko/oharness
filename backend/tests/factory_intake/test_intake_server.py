import base64
import hashlib
import hmac
import json
import time

import pytest
from intake_client import TestClient

from factory_intake.config import parse_webhook
from factory_intake.deliveries import DeliveryLog
from factory_intake.memory import MemoryFactory
from factory_intake.server import create_app
from factory_intake.tokens import ClientTokens
from secret_store.memory import MemorySecrets

GH_FIX = __import__("pathlib").Path(__file__).parent / "fixtures" / "github"


def sig(secret: bytes, body: bytes) -> str:
    return "sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest()


@pytest.fixture
def env(tmp_path):
    secrets = MemorySecrets()
    for name, value in {"hook-token": "tok-secret", "hook-gh": "gh-secret", "hook-generic": "gen-secret", "hook-std": "whsec_" + base64.b64encode(b"std-key").decode()}.items():
        secrets.put(f"factory/{name}", value)
    hooks = {
        "ci": parse_webhook("ci", "authMode: token\nsecretRef: factory/hook-token\n"),
        "gh": parse_webhook("gh", "authMode: signature\nsignatureScheme: github\nsecretRef: factory/hook-gh\ngithub:\n  repos: [acme/payments]\n  handle: '@payments'\n  labels: [factory]\n"),
        "gen": parse_webhook("gen", "authMode: signature\nsignatureScheme: generic\nsecretRef: factory/hook-generic\ndeliveryIdHeader: X-Event-Id\n"),
        "std": parse_webhook("std", "authMode: signature\nsignatureScheme: standard\nsecretRef: factory/hook-std\n"),
        "off": parse_webhook("off", "authMode: token\nsecretRef: factory/hook-token\nenabled: false\n"),
    }
    port, log = MemoryFactory(), DeliveryLog(tmp_path / "d.db")
    seen = []
    app = create_app(port, secrets, hooks, log, generic_handler=lambda cfg, headers, payload, did: seen.append((cfg.name, payload, did)) or [], max_body=1000)
    return TestClient(app), port, log, secrets, seen


def test_the_app_exposes_only_hooks_and_api(env):
    client, *_ = env
    for path in ("/docs", "/openapi.json", "/health", "/"):
        assert client.get(path).status_code in (404, 405)


def test_unknown_and_disabled_webhooks_are_indistinguishable_404(env):
    client, *_ = env
    a, b = client.post("/hooks/nope", content=b"{}"), client.post("/hooks/off", content=b"{}", headers={"authorization": "Bearer tok-secret"})
    assert a.status_code == b.status_code == 404 and a.json() == b.json()


def test_bearer_webhook_accepts_with_202_and_a_delivery_id_and_records_the_redacted_payload(env):
    client, _, log, _, seen = env
    body = json.dumps({"event": "deploy", "note": "token=supersecretvalue1"}).encode()
    r = client.post("/hooks/ci", content=body, headers={"authorization": "Bearer tok-secret"})
    assert r.status_code == 202 and r.json()["delivery_id"] == hashlib.sha256(body).hexdigest()
    [row] = log.recent("ci")
    assert row["outcome"] == "accepted" and "supersecretvalue1" not in row["payload"]
    assert seen and seen[0][0] == "ci"


def test_wrong_or_missing_credentials_are_401_and_log_metadata_only(env):
    client, _, log, *_ = env
    for headers in ({}, {"authorization": "Bearer nope"}):
        assert client.post("/hooks/ci", content=b"{}", headers=headers).status_code == 401
    assert [r["outcome"] for r in log.recent("ci")] == ["rejected_auth", "rejected_auth"] and all(r["payload"] is None for r in log.recent("ci"))


def test_bad_json_is_400_and_oversize_is_413(env):
    client, _, log, *_ = env
    h = {"authorization": "Bearer tok-secret"}
    assert client.post("/hooks/ci", content=b"not json", headers=h).status_code == 400
    assert client.post("/hooks/ci", content=b"x" * 1001, headers=h).status_code == 413
    assert [r["outcome"] for r in log.recent("ci")] == ["rejected_size", "rejected_json"]


def test_a_repeated_delivery_is_a_duplicate_that_still_answers_202(env):
    client, _, log, _, seen = env
    h = {"authorization": "Bearer tok-secret"}
    body = b'{"a":1}'
    assert client.post("/hooks/ci", content=body, headers=h).status_code == 202
    again = client.post("/hooks/ci", content=body, headers=h)
    assert again.status_code == 202 and again.json()["duplicate"] is True and len(seen) == 1
    assert log.recent("ci")[0]["outcome"] == "duplicate"


def test_generic_signature_and_a_configured_delivery_id_header(env):
    client, *_ = env
    body = b'{"x":1}'
    ok = client.post("/hooks/gen", content=body, headers={"x-oharness-signature": sig(b"gen-secret", body), "x-event-id": "evt-1"})
    assert ok.status_code == 202 and ok.json()["delivery_id"] == "evt-1"
    assert client.post("/hooks/gen", content=body, headers={"x-oharness-signature": sig(b"wrong", body)}).status_code == 401


def test_standard_webhooks_signature_and_its_five_minute_window(env):
    client, *_ = env
    body = b'{"x":1}'

    def headers(stamp):
        mac = hmac.new(b"std-key", f"msg_1.{stamp}.".encode() + body, hashlib.sha256).digest()
        return {"webhook-id": "msg_1", "webhook-timestamp": str(stamp), "webhook-signature": "v1," + base64.b64encode(mac).decode()}

    assert client.post("/hooks/std", content=body, headers=headers(int(time.time()))).status_code == 202
    old = client.post("/hooks/std", content=body, headers=headers(int(time.time()) - 600))
    assert old.status_code == 401 and old.json()["code"] == "stale"


def test_github_webhook_creates_an_item_then_a_comment_follows_up_and_a_forgery_is_refused(env):
    client, port, *_ = env

    def post(name, event, delivery_id, secret=b"gh-secret"):
        body = (GH_FIX / f"{name}.json").read_bytes()
        return client.post("/hooks/gh", content=body, headers={"x-github-event": event, "x-github-delivery": delivery_id, "x-hub-signature-256": sig(secret, body)})

    assert post("issues_opened_with_mention", "issues", "g-1").status_code == 202
    assert post("issue_comment_mention", "issue_comment", "g-2").status_code == 202
    [item] = port.list()
    assert item.source.kind == "github" and item.source.thread_ref == "acme/payments#7"
    assert port.comments[item.id][0][1] == "@payments please triage this"
    assert post("issue_comment_mention", "issue_comment", "g-3", secret=b"forged").status_code == 401
    assert len(port.list()) == 1


def test_a_failed_handler_is_a_500_without_details_and_the_delivery_can_be_retried(env, tmp_path):
    client, port, log, secrets, _ = env
    boom = {"on": True}

    def handler(cfg, headers, payload, did):
        if boom["on"]:
            raise RuntimeError("database password=hunter2hunter2")
        return []

    app = create_app(port, secrets, {"ci": parse_webhook("ci", "authMode: token\nsecretRef: factory/hook-token\n")}, log, generic_handler=handler)
    c = TestClient(app)
    h = {"authorization": "Bearer tok-secret"}
    r = c.post("/hooks/ci", content=b'{"a":1}', headers=h)
    assert r.status_code == 500 and "hunter2" not in r.text
    boom["on"] = False
    assert c.post("/hooks/ci", content=b'{"a":1}', headers=h).status_code == 202


def test_rate_limit_per_webhook_answers_429_with_retry_after(env):
    client, *_ = env
    h = {"authorization": "Bearer tok-secret"}
    codes = [client.post("/hooks/ci", content=json.dumps({"n": i}).encode(), headers=h).status_code for i in range(62)]
    assert codes[:60] == [202] * 60 and codes[60] == 429
    assert client.post("/hooks/ci", content=b"{}", headers=h).headers["retry-after"] == "60"


def test_failed_credentials_have_their_own_budget(env):
    client, *_ = env
    codes = [client.post("/hooks/ci", content=b"{}", headers={"authorization": "Bearer bad"}).status_code for _ in range(22)]
    assert codes[0] == 401 and codes[-1] == 429
    assert client.post("/hooks/gen", content=b"{}", headers={"x-oharness-signature": "x"}).status_code == 401  # another webhook is unaffected


# -- integration API ---------------------------------------------------------------------------------------------------------------------
def token(env, scopes=("work:read", "work:write", "work:claim"), kind="cli", name="agent-a"):
    return {"authorization": "Bearer " + ClientTokens(env[3]).create(name, list(scopes), kind)}


def test_api_requires_a_known_token_and_the_right_scope(env):
    client, *_ = env
    assert client.get("/api/work-items").status_code == 401
    assert client.get("/api/work-items", headers={"authorization": "Bearer ohf_nope"}).status_code == 401
    read_only = token(env, ("work:read",))
    assert client.get("/api/work-items", headers=read_only).status_code == 200
    r = client.post("/api/work-items", json={"title": "t"}, headers=read_only)
    assert r.status_code == 403 and r.json()["code"] == "forbidden"


def test_api_lifecycle_create_status_comment_claim_release_cancel(env):
    client, port, *_ = env
    h = token(env)
    created = client.post("/api/work-items", json={"title": "Fix rounding", "body": "details", "idempotency_key": "k1"}, headers=h)
    assert created.status_code == 201
    item = created.json()["item"]
    assert item["source"]["kind"] == "cli" and item["state"] == "queued"
    assert client.post("/api/work-items", json={"title": "Fix rounding", "idempotency_key": "k1"}, headers=h).json()["outcome"] == "replay"
    assert client.get(f"/api/work-items/{item['id']}", headers=h).json()["title"] == "Fix rounding"
    assert client.post(f"/api/work-items/{item['id']}/comments", json={"text": "more context"}, headers=h).status_code == 201
    assert port.comments[item["id"]] == [("client:agent-a", "more context")]
    claimed = client.post(f"/api/work-items/{item['id']}/claim", json={"holder": "claude-code"}, headers=h).json()
    assert claimed["state"] == "claimed" and claimed["claim"]["holder"] == "claude-code"
    assert client.post(f"/api/work-items/{item['id']}/claim", json={"holder": "codex"}, headers=h).status_code == 409
    released = client.post(f"/api/work-items/{item['id']}/release", json={"summary": "done locally", "branch": "fix/rounding", "status": "needs_review"}, headers=h).json()
    assert released["state"] == "awaiting_human"
    assert client.post(f"/api/work-items/{item['id']}/release", json={"summary": "x", "status": "done"}, headers=h).status_code == 422
    assert client.post(f"/api/work-items/{item['id']}/cancel", headers=h).json()["state"] == "cancelled"
    assert client.get("/api/work-items/nope", headers=h).status_code == 404
    assert client.get("/api/metrics", headers=h).json()["by_state"]["cancelled"] == 1


def test_a_client_cannot_pass_as_github_or_choose_a_thread(env):
    client, *_ = env
    h = token(env)
    r = client.post("/api/work-items", json={"title": "t", "source": {"kind": "github"}, "thread_ref": "acme/payments#1"}, headers=h)
    assert r.status_code == 422  # unknown fields are refused
    item = client.post("/api/work-items", json={"title": "t"}, headers=h).json()["item"]
    assert item["source"]["kind"] == "cli" and item["source"]["thread_ref"] is None


def test_api_validates_and_limits_bodies(env):
    client, *_ = env
    h = token(env)
    assert client.post("/api/work-items", json={"title": ""}, headers=h).status_code == 422
    assert client.post("/api/work-items", content=b"x" * 1001, headers=h).status_code == 413
    assert client.post("/api/work-items", content=b"not json", headers=h).status_code == 422


def test_revoked_tokens_stop_working_and_only_a_hash_is_stored(env):
    client, _, _, secrets, _ = env
    tokens = ClientTokens(secrets)
    raw = tokens.create("temp", ["work:read"])
    assert client.get("/api/work-items", headers={"authorization": f"Bearer {raw}"}).status_code == 200
    assert raw not in secrets.get("factory/api-tokens")
    assert tokens.revoke("temp") and client.get("/api/work-items", headers={"authorization": f"Bearer {raw}"}).status_code == 401
