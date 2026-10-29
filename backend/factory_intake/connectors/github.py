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
from ..security import Rejected, safe_for_log, secret_ref, verify_hmac_sha256

API = "https://api.github.com"
TOKEN_NAME, WEBHOOK_SECRET_NAME = "github-token", "github-webhook-secret"
_THREAD = re.compile(r"^([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100})#([0-9]{1,9})$")
_ISSUE_EVENTS = {"opened", "edited", "reopened", "labeled"}
_PR_EVENTS = {"opened", "edited", "reopened", "ready_for_review", "labeled"}
MAX_REPLY = 60_000


class ConnectorError(Exception):
    """A call to the source failed. The message is generic: no token, no response body."""


@dataclass(frozen=True)
class PollState:
    since: str  # ISO-8601 time of the last poll; GitHub returns only activity after it


class GitHubConnector:
    kind = "github"

    def __init__(self, allowed_repos: frozenset[str] | set[str] = frozenset(), secrets=None, client: httpx.Client | None = None):
        """``allowed_repos`` is ``owner/name``; empty means nothing is accepted (fail closed)."""
        self.allowed_repos = frozenset(r.lower() for r in allowed_repos)
        self._secrets = secrets
        self._client = client

    def required_scopes(self) -> tuple[str, ...]:
        return ("issues:write", "pull_requests:write", "metadata:read")

    # -- webhook -----------------------------------------------------------------------------------------------------------------
    def verify(self, delivery: Delivery) -> str:
        """Check the HMAC against the secret in the store and return the delivery id (for the replay guard)."""
        secret = (self._secrets.get(secret_ref(WEBHOOK_SECRET_NAME)) if self._secrets else None) or ""
        verify_hmac_sha256(secret.encode(), delivery.body, delivery.headers.get("x-hub-signature-256"))
        delivery_id = delivery.headers.get("x-github-delivery", "").strip()
        if not delivery_id:
            raise Rejected("no_delivery_id", "missing delivery id", 400)
        return delivery_id

    def parse(self, delivery: Delivery, rules: TriggerRules) -> list[WorkItemDraft]:
        event = delivery.headers.get("x-github-event", "")
        delivery_id = delivery.headers.get("x-github-delivery", "")
        try:
            payload = json.loads(delivery.body)
        except (ValueError, UnicodeDecodeError):
            raise Rejected("bad_payload", "body is not JSON", 400) from None
        if not isinstance(payload, dict) or not delivery_id:
            raise Rejected("bad_payload", "unexpected payload", 400)
        return self.parse_event(event, payload, delivery_id, rules)

    def parse_event(self, event: str, payload: dict, delivery_id: str, rules: TriggerRules) -> list[WorkItemDraft]:
        """Shared by webhooks and polling (``delivery_id`` is for the replay guard, not for idempotency: see the keys below). Anything not selected by the rules (or not from an allowed repo/author) is ignored."""
        try:
            repo = payload["repository"]["full_name"]
            sender = payload["sender"]
            login = str(sender["login"])
        except (KeyError, TypeError):
            return []
        if repo.lower() not in self.allowed_repos or str(sender.get("type", "")).lower() == "bot" or login.endswith("[bot]"):
            return []  # not a repo we were told to serve, or our own / another bot's comment (avoids loops)
        if not rules.author_allowed(login):
            return []
        action = payload.get("action", "")
        item = payload.get("pull_request") or payload.get("issue")
        if not isinstance(item, dict) or "number" not in item:
            return []
        is_pr = "pull_request" in payload or "pull_request" in item
        text, key = None, ""
        if event in ("issues", "pull_request"):
            if action not in (_PR_EVENTS if event == "pull_request" else _ISSUE_EVENTS):
                return []
            labeled = action == "labeled" and (payload.get("label") or {}).get("name") in rules.labels
            if labeled:
                text, key = item.get("body") or "", f"label:{payload['label']['name']}"
            elif action != "labeled" and rules.mentions(f"{item.get('title') or ''}\n{item.get('body') or ''}"):
                text, key = item.get("body") or "", "mention"  # one work item per issue/PR for its description, however often it is edited
        elif event in ("issue_comment", "pull_request_review_comment") and action == "created":
            comment = (payload.get("comment") or {}).get("body") or ""
            if rules.mentions(comment):
                text, key = comment, f"comment:{(payload.get('comment') or {}).get('id')}"  # the same comment is one item whether it arrives by webhook or poll
        if text is None:
            return []
        number = int(item["number"])
        thread = f"{repo}#{number}"
        return [clamp_draft(
            SourceRef(kind="github", external_id=f"{thread}", url=item.get("html_url"), thread_ref=thread),
            str(item.get("title") or ""), text,
            [str(l.get("name", "")) for l in item.get("labels", []) if isinstance(l, dict)] + (["pull-request"] if is_pr else []),
            login, f"{thread}:{key}",
        )]

    # -- reply ---------------------------------------------------------------------------------------------------------------------
    def reply(self, ref: SourceRef, text: str) -> None:
        match = _THREAD.match(ref.thread_ref or "")
        if not match or f"{match[1]}/{match[2]}".lower() not in self.allowed_repos:
            raise ConnectorError("thread is not one this connector serves")
        token = (self._secrets.get(secret_ref(TOKEN_NAME)) if self._secrets else None) or ""
        if not token:
            raise ConnectorError("no GitHub token is stored for the factory")
        body = redact(text)[0][:MAX_REPLY]
        client = self._client or httpx.Client(timeout=15, follow_redirects=False)
        try:
            response = client.post(
                f"{API}/repos/{match[1]}/{match[2]}/issues/{match[3]}/comments", json={"body": body},
                headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
            )
        except httpx.HTTPError:
            raise ConnectorError("GitHub request failed") from None
        if response.status_code != 201:
            raise ConnectorError(f"GitHub refused the comment (HTTP {response.status_code})")

    # -- polling -------------------------------------------------------------------------------------------------------------------
    def poll(self, rules: TriggerRules, state: PollState, now_iso: str) -> tuple[list[WorkItemDraft], PollState]:
        """Fetch comments and labeled issues since ``state`` for each allowed repo (first page, 100 per call). No port is opened."""
        token = (self._secrets.get(secret_ref(TOKEN_NAME)) if self._secrets else None) or ""
        if not token:
            raise ConnectorError("no GitHub token is stored for the factory")
        client = self._client or httpx.Client(timeout=15, follow_redirects=False)
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}

        def get(path: str, **params):
            try:
                response = client.get(f"{API}{path}", params=params, headers=headers)
            except httpx.HTTPError:
                raise ConnectorError("GitHub request failed") from None
            if response.status_code != 200:
                raise ConnectorError(f"GitHub refused the request (HTTP {response.status_code})")
            return response.json()

        drafts: list[WorkItemDraft] = []
        for repo in sorted(self.allowed_repos):
            full = {"full_name": repo}
            for comment in get(f"/repos/{repo}/issues/comments", since=state.since, per_page=100):
                if not rules.mentions(comment.get("body") or ""):
                    continue
                issue = get(f"/repos/{repo}/issues/{comment['issue_url'].rsplit('/', 1)[-1]}")
                drafts += self.parse_event("issue_comment", {"action": "created", "issue": issue, "comment": comment, "sender": comment["user"], "repository": full}, f"poll-comment-{comment['id']}", rules)
            for label in sorted(rules.labels):
                for issue in get(f"/repos/{repo}/issues", labels=label, state="open", since=state.since, per_page=100):
                    drafts += self.parse_event("issues", {"action": "labeled", "label": {"name": label}, "issue": issue, "sender": issue["user"], "repository": full}, f"poll-label-{issue['id']}-{label}", rules)
        return drafts, PollState(since=now_iso)
