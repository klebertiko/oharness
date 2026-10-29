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
    [by_mention] = connector().parse(delivery("issues_opened_with_mention", "issues"), RULES)
    assert by_label.idempotency_key == by_mention.idempotency_key == "acme/payments#7:item"  # one item per issue, whichever trigger came first
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


def sign(body: bytes) -> dict:
    return {"x-github-event": "issues", "x-github-delivery": "d", "x-hub-signature-256": "sha256=" + hmac.new(b"whsec", body, hashlib.sha256).hexdigest()}


def test_malformed_bodies_are_rejected_not_crashed():
    for body in (b"not json", b"[]", b"\xff\xfe"):
        with pytest.raises(Rejected):
            connector().parse(Delivery(sign(body), body), RULES)


def test_parse_refuses_an_unsigned_or_forged_payload_by_itself():
    body = (FIX / "issue_comment_mention.json").read_bytes()
    for headers in ({"x-github-event": "issue_comment", "x-github-delivery": "d"}, {**sign(b"other"), "x-github-event": "issue_comment"}):
        with pytest.raises(Rejected) as exc:
            connector().parse(Delivery(headers, body), RULES)
        assert exc.value.status == 401


def test_weird_shapes_are_ignored_not_500():
    c = connector()
    for payload in ({"repository": {"full_name": 5}, "sender": {"login": "a"}}, {"repository": {"full_name": "acme/payments"}, "sender": None},
                    {"repository": {"full_name": "acme/payments"}, "sender": {"login": "a"}, "issue": {"number": "x"}, "action": "opened"}):
        assert c.parse_event("issues", payload, "d", RULES) == []


def test_the_factorys_own_comments_never_start_work_even_from_a_user_token():
    payload = json.loads((FIX / "issue_comment_mention.json").read_text())
    own = GitHubConnector(frozenset({"acme/payments"}), secrets(), self_logins={"Alice"})
    assert own.parse_event("issue_comment", payload, "d", RULES) == []
    payload["comment"]["body"] = "@payments status ... <!-- oharness-factory -->"
    assert connector().parse_event("issue_comment", payload, "d", RULES) == []


def test_labels_match_case_insensitively_and_repo_casing_does_not_change_the_key():
    payload = json.loads((FIX / "issues_labeled_trigger.json").read_text())
    payload["label"]["name"], payload["repository"]["full_name"] = "FACTORY", "Acme/Payments"
    [draft] = connector().parse_event("issues", payload, "d", RULES)
    assert draft.idempotency_key == "acme/payments#7:item"


def test_reply_posts_to_the_same_issue_with_the_token_and_redacts_the_text():
    seen = {}

    def handler(request: httpx.Request):
        seen.update(url=str(request.url), auth=request.headers["authorization"], body=json.loads(request.content))
        return httpx.Response(201, json={})

    c = connector(httpx.Client(transport=httpx.MockTransport(handler)))
    c.reply(SourceRef(kind="github", external_id="x", thread_ref="acme/payments#7"), "done, see " + TOKEN)
    assert seen["url"] == "https://api.github.com/repos/acme/payments/issues/7/comments"
    assert seen["auth"] == f"Bearer {TOKEN}" and TOKEN not in seen["body"]["body"] and seen["body"]["body"].endswith("<!-- oharness-factory -->")


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


def poll_handler(comment, issue, labeled_issue, calls):
    def handler(request: httpx.Request):
        path = request.url.path
        calls.append(path)
        assert request.headers["authorization"] == f"Bearer {TOKEN}"
        if path.endswith("/issues/comments"):
            assert request.url.params["since"] == "2026-01-01T00:00:00Z"
            return httpx.Response(200, json=[{**comment["comment"], "issue_url": "https://api.github.com/repos/acme/payments/issues/7"}] * 3)
        if path.endswith("/issues/7"):
            return httpx.Response(200, json=issue)
        if path.endswith("/issues/7/events"):
            return httpx.Response(200, json=[{"event": "labeled", "label": {"name": "factory"}, "actor": {"login": "maintainer", "type": "User"}}])
        if path.endswith("/issues"):
            return httpx.Response(200, json=[{**labeled_issue, "id": 77, "user": {"login": "outsider", "type": "User"}}])
        pytest.fail(path)
    return handler


def test_polling_yields_the_same_drafts_and_keys_as_webhooks_and_fetches_each_issue_once():
    comment = json.loads((FIX / "issue_comment_mention.json").read_text())
    labeled = json.loads((FIX / "issues_labeled_trigger.json").read_text())["issue"]
    calls: list[str] = []
    c = connector(httpx.Client(transport=httpx.MockTransport(poll_handler(comment, comment["issue"], labeled, calls))))
    drafts, state = c.poll(RULES, PollState("2026-01-01T00:00:00Z"), "2026-01-02T00:00:00Z")
    assert sorted({d.idempotency_key for d in drafts}) == ["acme/payments#7:comment:501", "acme/payments#7:item"]
    assert calls.count("/repos/acme/payments/issues/7") == 1 and state.since == "2026-01-02T00:00:00Z"


def test_polling_attributes_a_label_to_whoever_applied_it_like_the_webhook_does():
    comment = json.loads((FIX / "issue_comment_mention.json").read_text())
    labeled = json.loads((FIX / "issues_labeled_trigger.json").read_text())["issue"]
    rules = TriggerRules(handle="@payments", labels=frozenset({"factory"}), allowed_authors=frozenset({"maintainer"}))
    c = connector(httpx.Client(transport=httpx.MockTransport(poll_handler(comment, comment["issue"], labeled, []))))
    drafts, _ = c.poll(rules, PollState("2026-01-01T00:00:00Z"), "2026-01-02T00:00:00Z")
    assert [d.requested_by for d in drafts] == ["maintainer"]  # the outsider-authored issue is accepted because a maintainer labeled it


def test_polling_a_description_mention_works_without_a_webhook():
    issue = json.loads((FIX / "issues_opened_with_mention.json").read_text())["issue"]

    def handler(request: httpx.Request):
        return httpx.Response(200, json=[issue] if request.url.path.endswith("/issues") else [])

    drafts, _ = connector(httpx.Client(transport=httpx.MockTransport(handler))).poll(RULES, PollState("t0"), "t1")
    assert [d.idempotency_key for d in drafts] == ["acme/payments#7:item"]


def test_a_cut_listing_resumes_where_it_stopped_instead_of_skipping():
    def handler(request: httpx.Request):
        if request.url.path.endswith("/issues/comments"):
            nxt = '<https://api.github.com/repos/acme/payments/issues/comments?page=2>; rel="next"'
            return httpx.Response(200, json=[{"id": 1, "body": "x", "updated_at": "2026-01-01T05:00:00Z", "user": None}], headers={"Link": nxt})
        return httpx.Response(200, json=[])

    _, state = connector(httpx.Client(transport=httpx.MockTransport(handler))).poll(RULES, PollState("2026-01-01T00:00:00Z"), "2026-01-09T00:00:00Z")
    assert state.since == "2026-01-01T05:00:00Z"
