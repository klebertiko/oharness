import hashlib
import hmac
import json
from pathlib import Path

import httpx
import pytest

from factory_intake.connector import Connector, Delivery, TriggerRules
from factory_intake.connectors.github import ConnectorError, GitHubConnector, PollState
from factory_intake.port import SourceRef
from factory_intake.security import Rejected, secret_ref
from secret_store.memory import MemorySecrets

FIX = Path(__file__).parent / "fixtures" / "github"
RULES = TriggerRules(handle="@payments", labels=frozenset({"factory"}))
TOKEN = "ghp_" + "t" * 36


def secrets():
    store = MemorySecrets()
    store.put(secret_ref("github-webhook-secret"), "whsec")
    store.put(secret_ref("github-token"), TOKEN)
    return store


def connector(client=None, repos=("acme/payments",)):
    return GitHubConnector(frozenset(repos), secrets(), client)


def delivery(name, event, secret=b"whsec", delivery_id="d-1"):
    body = (FIX / f"{name}.json").read_bytes()
    sig = "sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest()
    return Delivery({"x-github-event": event, "x-github-delivery": delivery_id, "x-hub-signature-256": sig}, body)


def test_it_is_a_connector_and_names_minimal_scopes():
    c = connector()
    assert isinstance(c, Connector) and c.kind == "github"
    assert "contents:write" not in c.required_scopes()


def test_verify_accepts_the_right_signature_and_refuses_a_wrong_one():
    assert connector().verify(delivery("issue_comment_mention", "issue_comment")) == "d-1"
    with pytest.raises(Rejected) as exc:
        connector().verify(delivery("issue_comment_mention", "issue_comment", secret=b"nope"))
    assert exc.value.status == 401


def test_verify_without_a_stored_secret_refuses():
    with pytest.raises(Rejected) as exc:
        GitHubConnector(frozenset({"acme/payments"}), MemorySecrets()).verify(delivery("issue_comment_mention", "issue_comment"))
    assert exc.value.status == 503


def test_a_mention_in_a_comment_becomes_a_draft_with_a_thread_to_answer_in():
    [draft] = connector().parse(delivery("issue_comment_mention", "issue_comment"), RULES)
    assert draft.title == "Checkout fails" and draft.body == "@payments please triage this"
    assert draft.source.thread_ref == "acme/payments#7" and draft.requested_by == "alice"
    assert draft.idempotency_key == "acme/payments#7:comment:501"


@pytest.mark.parametrize("name,event", [
    ("issue_comment_no_mention", "issue_comment"), ("issue_comment_by_bot", "issue_comment"),
    ("issue_comment_other_repo", "issue_comment"), ("issues_labeled_other", "issues"),
])
def test_unselected_activity_is_ignored(name, event):
    assert connector().parse(delivery(name, event), RULES) == []


def test_a_trigger_label_and_a_mention_in_the_description_both_start_work():
    [by_label] = connector().parse(delivery("issues_labeled_trigger", "issues"), RULES)
    assert by_label.idempotency_key == "acme/payments#7:label:factory"
    [by_mention] = connector().parse(delivery("issues_opened_with_mention", "issues"), RULES)
    assert by_mention.idempotency_key == "acme/payments#7:mention"
    [pr] = connector().parse(delivery("pull_request_opened_with_mention", "pull_request"), RULES)
    assert "pull-request" in pr.labels and pr.source.thread_ref == "acme/payments#9"


def test_no_allowed_repos_means_nothing_is_accepted():
    assert connector(repos=()).parse(delivery("issue_comment_mention", "issue_comment"), RULES) == []


def test_only_allowed_authors_can_trigger():
    rules = TriggerRules(handle="@payments", allowed_authors=frozenset({"bob"}))
    assert connector().parse(delivery("issue_comment_mention", "issue_comment"), rules) == []


def test_injection_text_is_only_stored_as_data():
    [draft] = connector().parse(delivery("injection_comment", "issue_comment"), RULES)
    assert "IGNORE ALL PREVIOUS INSTRUCTIONS" in draft.body  # kept as data to show a person; never executed or elevated here


def test_malformed_bodies_are_rejected_not_crashed():
    for body in (b"not json", b"[]", b"\xff\xfe"):
        with pytest.raises(Rejected):
            connector().parse(Delivery({"x-github-event": "issues", "x-github-delivery": "d"}, body), RULES)


def test_reply_posts_to_the_same_issue_with_the_token_and_redacts_the_text():
    seen = {}

    def handler(request: httpx.Request):
        seen.update(url=str(request.url), auth=request.headers["authorization"], body=json.loads(request.content))
        return httpx.Response(201, json={})

    c = connector(httpx.Client(transport=httpx.MockTransport(handler)))
    c.reply(SourceRef(kind="github", external_id="x", thread_ref="acme/payments#7"), "done, see " + TOKEN)
    assert seen["url"] == "https://api.github.com/repos/acme/payments/issues/7/comments"
    assert seen["auth"] == f"Bearer {TOKEN}" and TOKEN not in seen["body"]["body"]


@pytest.mark.parametrize("thread", ["evil/other#1", "acme/payments#1/../../x", "acme/payments", None, "acme/payments#7?x=1"])
def test_reply_refuses_threads_it_does_not_serve(thread):
    c = connector(httpx.Client(transport=httpx.MockTransport(lambda r: pytest.fail("no request expected"))))
    with pytest.raises(ConnectorError):
        c.reply(SourceRef(kind="github", external_id="x", thread_ref=thread), "hi")


def test_a_failed_reply_raises_a_generic_error_without_the_token_or_body():
    c = connector(httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(403, text=f"bad {TOKEN}"))))
    with pytest.raises(ConnectorError) as exc:
        c.reply(SourceRef(kind="github", external_id="x", thread_ref="acme/payments#7"), "hi")
    assert TOKEN not in str(exc.value) and "403" in str(exc.value)


def test_reply_without_a_token_refuses():
    c = GitHubConnector(frozenset({"acme/payments"}), MemorySecrets())
    with pytest.raises(ConnectorError):
        c.reply(SourceRef(kind="github", external_id="x", thread_ref="acme/payments#7"), "hi")


def test_polling_yields_the_same_drafts_and_the_same_keys_as_webhooks():
    comment = json.loads((FIX / "issue_comment_mention.json").read_text())
    issue, labeled = comment["issue"], json.loads((FIX / "issues_labeled_trigger.json").read_text())["issue"]

    def handler(request: httpx.Request):
        path = request.url.path
        assert request.headers["authorization"] == f"Bearer {TOKEN}"
        assert path.endswith("/issues/7") or request.url.params["since"] == "2026-01-01T00:00:00Z"
        if path.endswith("/issues/comments"):
            return httpx.Response(200, json=[{**comment["comment"], "issue_url": "https://api.github.com/repos/acme/payments/issues/7"}])
        if path.endswith("/issues/7"):
            return httpx.Response(200, json=issue)
        if path.endswith("/issues"):
            return httpx.Response(200, json=[{**labeled, "id": 77}])
        pytest.fail(path)

    c = connector(httpx.Client(transport=httpx.MockTransport(handler)))
    drafts, state = c.poll(RULES, PollState("2026-01-01T00:00:00Z"), "2026-01-02T00:00:00Z")
    assert sorted(d.idempotency_key for d in drafts) == ["acme/payments#7:comment:501", "acme/payments#7:label:factory"]
    assert state.since == "2026-01-02T00:00:00Z"
