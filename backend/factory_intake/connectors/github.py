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
_ISSUE_EVENTS = {"opened", "edited", "reopened", "labeled"}
_PR_EVENTS = {"opened", "edited", "reopened", "ready_for_review", "labeled"}
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

    def __init__(self, allowed_repos=frozenset(), secrets=None, client: httpx.Client | None = None, self_logins=frozenset()):
        """``allowed_repos`` is ``owner/name`` (empty accepts nothing: fail closed). ``self_logins`` are the GitHub accounts the factory's
        token posts as; their comments are never work (replies also carry ``MARKER``)."""
        self.allowed_repos = frozenset(r.lower() for r in allowed_repos)
        self.self_logins = frozenset(l.lower() for l in self_logins)
        self._secrets = secrets
        self._client = client

    def required_scopes(self) -> tuple[str, ...]:
        return ("issues:write", "pull_requests:write", "metadata:read")

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    def _http(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(timeout=15, follow_redirects=False)
        return self._client

    def _token(self) -> str:
        token = (self._secrets.get(secret_ref(TOKEN_NAME)) if self._secrets else None) or ""
        if not token:
            raise ConnectorError("no GitHub token is stored for the factory")
        return token

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
        delivery_id = self.verify(delivery)
        try:
            payload = json.loads(delivery.body)
        except (ValueError, UnicodeDecodeError):
            raise Rejected("bad_payload", "body is not JSON", 400) from None
        if not isinstance(payload, dict):
            raise Rejected("bad_payload", "unexpected payload", 400)
        return self.parse_event(delivery.headers.get("x-github-event", ""), payload, delivery_id, rules)

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

    def parse_event(self, event: str, payload: dict, delivery_id: str, rules: TriggerRules) -> list[WorkItemDraft]:
        """Shared by webhooks and polling; ``delivery_id`` is for the replay guard, not for idempotency (see the keys below).
        Anything not selected by the rules, or malformed, is ignored."""
        try:
            return self._drafts(event, payload, rules)
        except (KeyError, TypeError, AttributeError, ValueError):
            return []

    def _drafts(self, event: str, payload: dict, rules: TriggerRules) -> list[WorkItemDraft]:
        repo = (payload.get("repository") or {}).get("full_name")
        login = self._sender_ok(repo, payload.get("sender"), rules)
        item = payload.get("pull_request") or payload.get("issue")
        if login is None or not isinstance(item, dict) or "number" not in item:
            return []
        action = payload.get("action", "")
        is_pr = "pull_request" in payload or "pull_request" in item
        text, key = None, ""
        if event in ("issues", "pull_request"):
            if action not in (_PR_EVENTS if event == "pull_request" else _ISSUE_EVENTS):
                return []
            label = str((payload.get("label") or {}).get("name", "")).lower()
            if (action == "labeled" and label in rules.labels) or (action != "labeled" and rules.mentions(f"{item.get('title') or ''}\n{item.get('body') or ''}")):
                text, key = item.get("body") or "", "item"  # one work item per issue/PR description, whether a label or a mention started it
        elif event in ("issue_comment", "pull_request_review_comment") and action == "created":
            comment = payload.get("comment") or {}
            body = comment.get("body") or ""
            if MARKER not in body and rules.mentions(body):
                text, key = body, f"comment:{comment.get('id')}"  # the same comment is one item whether it arrives by webhook or poll
        if text is None:
            return []
        thread = f"{repo.lower()}#{int(item['number'])}"
        return [clamp_draft(
            SourceRef(kind="github", external_id=thread, url=item.get("html_url"), thread_ref=thread),
            str(item.get("title") or ""), text,
            [str(l.get("name", "")) for l in item.get("labels", []) if isinstance(l, dict)] + (["pull-request"] if is_pr else []),
            login, f"{thread}:{key}",
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
            )
        except httpx.HTTPError:
            raise ConnectorError("GitHub request failed") from None
        if response.status_code != 201:
            raise ConnectorError(f"GitHub refused the comment (HTTP {response.status_code})")

    @staticmethod
    def _headers(token: str) -> dict:
        return {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}

    # -- polling -------------------------------------------------------------------------------------------------------------------
    def poll(self, rules: TriggerRules, state: PollState, now_iso: str) -> tuple[list[WorkItemDraft], PollState]:
        """Comments and issues/PRs updated since ``state``, per allowed repo, oldest first, up to ``MAX_PAGES`` pages of 100. Opens no port.

        Covers the same triggers as the webhook: a mention in a comment, a mention in a description, a trigger label (its actor is read from
        the issue's events so ``allowed_authors`` means the same on both paths). If a listing is cut at the page limit the returned state
        stops at the last item processed, so the next poll continues from there and nothing is skipped."""
        headers = self._headers(self._token())
        cursor, drafts = now_iso, []

        def get(path: str, **params):
            try:
                response = self._http().get(f"{API}{path}", params=params, headers=headers)
            except httpx.HTTPError:
                raise ConnectorError("GitHub request failed") from None
            if response.status_code != 200:
                raise ConnectorError(f"GitHub refused the request (HTTP {response.status_code})")
            return response

        def listing(path: str, **params) -> tuple[list[dict], str | None]:
            """(items, resume_at): resume_at is the last ``updated_at`` seen when the listing was cut, else None."""
            items: list[dict] = []
            url, query = path, {**params, "since": state.since, "sort": "updated", "direction": "asc", "per_page": 100}
            for _ in range(MAX_PAGES):
                response = get(url, **query)
                items += response.json()
                nxt = response.links.get("next", {}).get("url")
                if not nxt:
                    return items, None
                url, query = nxt.removeprefix(API), {}
            return items, items[-1].get("updated_at") if items else None

        issues_cache: dict[tuple[str, int], dict] = {}
        for repo in sorted(self.allowed_repos):
            full = {"full_name": repo}
            comments, cut = listing(f"/repos/{repo}/issues/comments")
            cursor = min(cursor, cut) if cut else cursor
            for comment in comments:
                user = comment.get("user")
                if MARKER in (comment.get("body") or "") or not rules.mentions(comment.get("body") or "") or self._sender_ok(repo, user, rules) is None:
                    continue
                number = int(str(comment["issue_url"]).rsplit("/", 1)[-1])
                if (repo, number) not in issues_cache:
                    issues_cache[(repo, number)] = get(f"/repos/{repo}/issues/{number}").json()
                drafts += self.parse_event("issue_comment", {"action": "created", "issue": issues_cache[(repo, number)], "comment": comment, "sender": user, "repository": full}, f"poll-comment-{comment['id']}", rules)
            issues, cut = listing(f"/repos/{repo}/issues", state="open")
            cursor = min(cursor, cut) if cut else cursor
            for issue in issues:
                names = {str(l.get("name", "")).lower() for l in issue.get("labels", []) if isinstance(l, dict)}
                trigger = sorted(names & rules.labels)
                if trigger:
                    events = get(f"/repos/{repo}/issues/{issue['number']}/events", per_page=100).json()
                    actor = next((e.get("actor") for e in reversed(events) if e.get("event") == "labeled" and str((e.get("label") or {}).get("name", "")).lower() == trigger[0]), None)
                    drafts += self.parse_event("issues", {"action": "labeled", "label": {"name": trigger[0]}, "issue": issue, "sender": actor, "repository": full}, f"poll-label-{issue['number']}", rules)
                drafts += self.parse_event("issues", {"action": "edited", "issue": issue, "sender": issue.get("user"), "repository": full}, f"poll-issue-{issue['number']}", rules)
        return list({d.idempotency_key: d for d in drafts}.values()), PollState(since=cursor)
