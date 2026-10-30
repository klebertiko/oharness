"""GitHub as a work source (ADR 0060). Turns verified webhook deliveries (or polled activity, shaped the same way) into drafts and
answers in the same issue or PR.

Token scope, minimum: a fine-grained token (or GitHub App) limited to the chosen repositories with Issues read/write, Pull requests
read/write (comments) and Metadata read. No Contents:write, Administration or Workflows: this connector cannot push or merge, and the
factory never does either to a protected branch. The token is read from the secrets store at use time and never logged or echoed.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

import httpx

from sandbox.secrets import redact

from ..connector import Delivery, TriggerRules
from ..port import SourceRef, WorkItemDraft, clamp_draft
from ..security import Rejected, secret_ref, verify_hmac_sha256

API = "https://api.github.com"
TOKEN_NAME, WEBHOOK_SECRET_NAME = "github-token", "github-webhook-secret"
_THREAD = re.compile(r"^([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100})#([0-9]{1,9})$")
_ISSUE_EVENTS = {"opened", "reopened", "labeled"}  # an edit is not new content: it never starts work
_PR_EVENTS = {"opened", "reopened", "ready_for_review", "labeled"}
MAX_REPLY = 60_000
MAX_PAGES = 10
MARKER = "<!-- oharness-factory -->"  # on every reply: the factory never reacts to its own comments, whoever the token belongs to


class ConnectorError(Exception):
    """A call to the source failed. The message is generic: no token, no response body."""


@dataclass(frozen=True)
class PollState:
    since: str  # ISO-8601 time up to which activity was seen; if a listing was cut at MAX_PAGES this stops at the last item processed


class GitHubConnector:
    kind = "github"

    def __init__(self, allowed_repos=frozenset(), secrets=None, client: httpx.Client | None = None, self_logins=frozenset(),
                 webhook_secret_ref: str | None = None, token_ref: str | None = None):
        """``allowed_repos`` is ``owner/name`` (empty accepts nothing: fail closed). ``self_logins`` are the GitHub accounts the factory's
        token posts as; their comments are never work (replies also carry ``MARKER``). An injected ``client`` stays the caller's."""
        self.allowed_repos = frozenset(r.lower() for r in allowed_repos)
        self.self_logins = frozenset(l.lower() for l in self_logins)
        self._secrets = secrets
        self._client = client
        self._owns_client = client is None
        self._webhook_secret_ref = webhook_secret_ref or secret_ref(WEBHOOK_SECRET_NAME)
        self._token_ref = token_ref or secret_ref(TOKEN_NAME)

    def required_scopes(self) -> tuple[str, ...]:
        return ("issues:write", "pull_requests:write", "metadata:read")

    def close(self) -> None:
        if self._client is not None and self._owns_client:
            self._client.close()
            self._client = None

    def _http(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(timeout=15)
        return self._client

    def _token(self) -> str:
        token = (self._secrets.get(self._token_ref) if self._secrets else None) or ""
        if not token:
            raise ConnectorError("no GitHub token is stored for the factory")
        return token

    @staticmethod
    def _headers(token: str) -> dict:
        return {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}

    # -- webhook -----------------------------------------------------------------------------------------------------------------
    def verify(self, delivery: Delivery) -> str:
        """Check the HMAC against the secret in the store and return the delivery id (for the replay guard)."""
        secret = (self._secrets.get(self._webhook_secret_ref) if self._secrets else None) or ""
        verify_hmac_sha256(secret.encode(), delivery.body, delivery.headers.get("x-hub-signature-256"))
        delivery_id = delivery.headers.get("x-github-delivery", "").strip()
        if not delivery_id:
            raise Rejected("no_delivery_id", "missing delivery id", 400)
        return delivery_id

    def parse(self, delivery: Delivery, rules: TriggerRules) -> list[WorkItemDraft]:
        delivery_id = self.verify(delivery)
        try:
            payload = json.loads(delivery.body)
        except (ValueError, UnicodeDecodeError):
            raise Rejected("bad_payload", "body is not JSON", 400) from None
        if not isinstance(payload, dict):
            raise Rejected("bad_payload", "unexpected payload", 400)
        return self.parse_event(delivery.headers.get("x-github-event", ""), payload, f"delivery-{delivery_id}", rules)

    def _sender_ok(self, repo, sender, rules: TriggerRules) -> str | None:
        """The login if this repo and sender may trigger work, else None."""
        if not isinstance(repo, str) or not isinstance(sender, dict) or not isinstance(sender.get("login"), str):
            return None
        login = sender["login"]
        if repo.lower() not in self.allowed_repos or str(sender.get("type", "")).lower() == "bot" or login.lower().endswith("[bot]"):
            return None  # not a repo we were told to serve, or a bot (avoids loops)
        if login.lower() in self.self_logins or not rules.author_allowed(login):
            return None
        return login

    def parse_event(self, event: str, payload: dict, trigger_id: str, rules: TriggerRules) -> list[WorkItemDraft]:
        """Shared by webhooks and polling. ``trigger_id`` tells one trigger on an issue/PR from the next (a webhook delivery id, a label
        event id): re-labeling or reopening after the item closed is a new trigger and may start new work. Anything not selected by the
        rules, or not shaped as expected, is ignored."""
        repo = (payload.get("repository") or {}).get("full_name") if isinstance(payload.get("repository"), dict) else None
        login = self._sender_ok(repo, payload.get("sender"), rules)
        item = payload.get("pull_request") or payload.get("issue")
        if login is None or not isinstance(item, dict) or type(item.get("number")) is not int:
            return []
        action = payload.get("action", "")
        is_pr = "pull_request" in payload or "pull_request" in item
        text, key, reply = None, "", False
        if event in ("issues", "pull_request"):
            if action not in (_PR_EVENTS if event == "pull_request" else _ISSUE_EVENTS):
                return []
            label = str((payload.get("label") or {}).get("name", "")).lower()
            if (action == "labeled" and label in rules.labels) or (action != "labeled" and rules.mentions(f"{item.get('title') or ''}\n{item.get('body') or ''}")):
                text, key = item.get("body") or "", f"item:{trigger_id}"
        elif event in ("issue_comment", "pull_request_review_comment") and action == "created":
            comment = payload.get("comment")
            body = comment.get("body") if isinstance(comment, dict) else None
            if isinstance(body, str) and type(comment.get("id")) is int and MARKER not in body and rules.mentions(body):
                text, key, reply = body, f"comment:{comment['id']}", True  # one item per comment, the same by webhook or poll
        if text is None:
            return []
        thread = f"{repo.lower()}#{item['number']}"
        return [clamp_draft(
            SourceRef(kind="github", ref=thread, url=item.get("html_url"), thread_ref=thread),
            str(item.get("title") or ""), text,
            [str(l.get("name", "")) for l in item.get("labels", []) if isinstance(l, dict)] + (["pull-request"] if is_pr else []),
            login, f"{thread}:{key}", is_reply=reply,
        )]

    # -- reply ---------------------------------------------------------------------------------------------------------------------
    def reply(self, ref: SourceRef, text: str) -> None:
        match = _THREAD.match(ref.thread_ref or "")
        if not match or f"{match[1]}/{match[2]}".lower() not in self.allowed_repos:
            raise ConnectorError("thread is not one this connector serves")
        body = redact(text)[0][:MAX_REPLY] + "\n\n" + MARKER
        try:
            response = self._http().post(
                f"{API}/repos/{match[1]}/{match[2]}/issues/{match[3]}/comments", json={"body": body}, headers=self._headers(self._token()),
                follow_redirects=False,
            )
        except httpx.HTTPError:
            raise ConnectorError("GitHub request failed") from None
        if response.status_code != 201:
            raise ConnectorError(f"GitHub refused the comment (HTTP {response.status_code})")

    # -- polling -------------------------------------------------------------------------------------------------------------------
    def poll(self, rules: TriggerRules, state: PollState, now_iso: str) -> tuple[list[WorkItemDraft], PollState]:
        """What the webhook would have delivered since ``state``, per allowed repo, oldest first, up to ``MAX_PAGES`` pages of 100. Opens no port.

        Same triggers as the webhook: a mention in a comment (conversation or PR review), a mention in an issue/PR created since, and a
        trigger label applied since (its actor read from the issue's events, so ``allowed_authors`` means the same on both paths). Edits do
        not start work. If a listing is cut at the page limit the returned state stops at the last item processed, so nothing is skipped."""
        headers = self._headers(self._token())
        cursor, drafts = now_iso, []

        def get(target: str, **params):
            if target.startswith("http") and not target.startswith(API + "/"):
                raise ConnectorError("refusing to send the token to another host")
            try:
                response = self._http().get(target if target.startswith("http") else f"{API}{target}", params=params or None, headers=headers, follow_redirects=False)
            except httpx.HTTPError:
                raise ConnectorError("GitHub request failed") from None
            if response.status_code != 200:
                raise ConnectorError(f"GitHub refused the request (HTTP {response.status_code})")
            return response

        def listing(path: str, **params) -> tuple[list[dict], str | None]:
            """(items, resume_at): resume_at is the last ``updated_at`` seen when the listing was cut at MAX_PAGES, else None."""
            items: list[dict] = []
            target, query = path, {**params, "per_page": 100}
            for _ in range(MAX_PAGES):
                response = get(target, **query)
                items += [i for i in response.json() if isinstance(i, dict)]
                nxt = response.links.get("next", {}).get("url")
                if not nxt:
                    return items, None
                target, query = nxt, {}  # the next link already carries its whole query string
            return items, (items[-1].get("updated_at") if items else None)

        since = {"since": state.since, "sort": "updated", "direction": "asc"}
        cache: dict[str, dict] = {}
        for repo in sorted(self.allowed_repos):
            full = {"full_name": repo}
            for event, comments_path, parent_path, url_key, parent_key in (
                ("issue_comment", f"/repos/{repo}/issues/comments", f"/repos/{repo}/issues", "issue_url", "issue"),
                ("pull_request_review_comment", f"/repos/{repo}/pulls/comments", f"/repos/{repo}/pulls", "pull_request_url", "pull_request"),
            ):
                comments, cut = listing(comments_path, **since)
                cursor = min(cursor, cut) if cut else cursor
                for comment in comments:
                    body, user, number = comment.get("body"), comment.get("user"), str(comment.get(url_key, "")).rsplit("/", 1)[-1]
                    if not isinstance(body, str) or MARKER in body or not rules.mentions(body) or self._sender_ok(repo, user, rules) is None or not number.isdigit():
                        continue
                    if f"{parent_path}/{number}" not in cache:
                        cache[f"{parent_path}/{number}"] = get(f"{parent_path}/{number}").json()
                    drafts += self.parse_event(event, {"action": "created", parent_key: cache[f"{parent_path}/{number}"], "comment": comment, "sender": user, "repository": full}, "poll", rules)
            issues, cut = listing(f"/repos/{repo}/issues", state="open", **since)
            cursor = min(cursor, cut) if cut else cursor
            for issue in issues:
                if str(issue.get("created_at", "")) >= state.since:  # created since the last poll: an edit of an older issue is not new content
                    drafts += self.parse_event("issues", {"action": "opened", "issue": issue, "sender": issue.get("user"), "repository": full}, f"created-{issue.get('id')}", rules)
                names = {str(l.get("name", "")).lower() for l in issue.get("labels", []) if isinstance(l, dict)}
                for trigger in sorted(names & rules.labels):
                    events, _ = listing(f"/repos/{repo}/issues/{issue.get('number')}/events")
                    labeled = [e for e in events if e.get("event") == "labeled" and str((e.get("label") or {}).get("name", "")).lower() == trigger and str(e.get("created_at", "")) >= state.since]
                    if labeled:  # the latest application of the label since the last poll
                        drafts += self.parse_event("issues", {"action": "labeled", "label": {"name": trigger}, "issue": issue, "sender": labeled[-1].get("actor"), "repository": full}, f"label-{labeled[-1].get('id')}", rules)
        return list({d.idempotency_key: d for d in drafts}.values()), PollState(since=cursor)
