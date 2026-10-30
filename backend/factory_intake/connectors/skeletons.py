"""GitLab, Azure DevOps, Linear, Jira, Slack and Microsoft Teams as work sources: SKELETONS (ADR 0064).

Each one verifies its service's webhook authentication, turns a payload shaped like the service's public documentation into a
``WorkItemDraft`` and stops there. They are ``experimental``: payload shapes and signature schemes were written from the public
documentation and exercised only against hand-written fixtures, never against the real service, so nothing here is claimed to work until
someone verifies it with a real installation. ``reply`` raises ``NotImplementedError`` and none of them is wired into the intake server
yet. Like GitHub's connector they accept only what the secret holder sends, treat all text as untrusted data, and never run anything.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import math
import re
import time
from dataclasses import dataclass

from ..connector import Delivery, TriggerRules
from ..port import SourceRef, WorkItemDraft, clamp_draft
from ..security import Rejected, verify_bearer, verify_hmac_sha256, vault_key

EXPERIMENTAL = True


@dataclass(frozen=True)
class Extracted:
    """What a service payload says, before the trigger rules decide."""

    ref: str
    title: str
    text: str                     # the new content that may mention the factory
    key: str                      # what makes this activity the same as a repeat of it
    author: str
    url: str | None = None
    labels: tuple[str, ...] = ()
    bot: bool = False
    is_reply: bool = False
    explicit: bool = False        # the service itself says the factory was addressed (a Slack app mention, a Teams outgoing webhook)
    thread_ref: str | None = None
    body: str | None = None       # the item body when it differs from the triggering text


class SkeletonConnector:
    kind = ""
    secret_name = ""
    scopes: tuple[str, ...] = ()

    def __init__(self, secrets=None, now=time.time):
        self._secrets = secrets
        self._now = now

    experimental = EXPERIMENTAL

    def required_scopes(self) -> tuple[str, ...]:
        return self.scopes

    def reply(self, ref: SourceRef, text: str) -> None:
        raise NotImplementedError(f"{self.kind}: replying is not implemented; this connector is an experimental skeleton")

    # -- subclasses -----------------------------------------------------------------------------------------------------------------
    def verify(self, delivery: Delivery) -> str:
        raise NotImplementedError

    def extract(self, headers: dict, payload: dict) -> Extracted | None:
        raise NotImplementedError

    # -- shared ---------------------------------------------------------------------------------------------------------------------
    def _secret(self) -> str:
        return (self._secrets.get(vault_key(self.secret_name)) if self._secrets else None) or ""

    def parse(self, delivery: Delivery, rules: TriggerRules) -> list[WorkItemDraft]:
        self.verify(delivery)
        try:
            payload = json.loads(delivery.body)
        except (ValueError, UnicodeDecodeError):
            raise Rejected("bad_payload", "body is not JSON", 400) from None
        if not isinstance(payload, dict):
            raise Rejected("bad_payload", "unexpected payload", 400)
        try:
            found = self.extract({k.lower(): v for k, v in delivery.headers.items()}, payload)
        except (KeyError, TypeError, AttributeError, ValueError):
            found = None   # not shaped as documented: ignored, like any activity the rules do not select
        if found is None or found.bot or not rules.author_allowed(found.author):
            return []
        labeled = bool(rules.labels & {label.lower() for label in found.labels})
        if not (found.explicit or labeled or rules.mentions(found.text)):
            return []
        return [clamp_draft(SourceRef(kind=self.kind, ref=found.ref[:200], url=found.url, thread_ref=found.thread_ref or found.ref), found.title,
                            found.body if found.body is not None else found.text, list(found.labels), found.author, f"{found.ref}:{found.key}", is_reply=found.is_reply)]


def _text(value) -> str:
    return value if isinstance(value, str) else ""


class GitLab(SkeletonConnector):
    kind, secret_name, scopes = "gitlab", "gitlab-webhook-secret", ("api (or a project/group access token with Reporter+ and api)",)

    def verify(self, delivery: Delivery) -> str:
        verify_bearer(self._secret(), "Bearer " + delivery.headers.get("x-gitlab-token", ""))  # X-Gitlab-Token carries the shared secret
        return delivery.headers.get("x-gitlab-event-uuid") or hashlib.sha256(delivery.body).hexdigest()

    def extract(self, headers, payload):
        kind, attrs = payload["object_kind"], payload.get("object_attributes") or {}
        project, user = payload["project"]["path_with_namespace"].lower(), payload.get("user") or {}
        author = str(user.get("username", "")).lower()
        if kind == "note":
            parent = payload.get("merge_request") or payload.get("issue") or {}
            return Extracted(f"{project}!{parent['iid']}" if "merge_request" in payload else f"{project}#{parent['iid']}", _text(parent.get("title")), _text(attrs.get("note")),
                             f"note:{attrs['id']}", author, attrs.get("url"), is_reply=True)
        if kind in ("issue", "merge_request") and attrs.get("action") in ("open", "reopen"):
            sep = "!" if kind == "merge_request" else "#"
            return Extracted(f"{project}{sep}{attrs['iid']}", _text(attrs.get("title")), f"{_text(attrs.get('title'))}\n{_text(attrs.get('description'))}", f"{kind}:{attrs['id']}",
                             author, attrs.get("url"), tuple(l["title"] for l in payload.get("labels", [])), body=_text(attrs.get("description")))
        return None


class AzureDevOps(SkeletonConnector):
    kind, secret_name, scopes = "azdo", "azdo-webhook-secret", ("vso.work_write", "vso.code (read)")

    def verify(self, delivery: Delivery) -> str:
        header = delivery.headers.get("authorization", "")
        try:
            password = base64.b64decode(header[6:], validate=True).decode().partition(":")[2] if header.lower().startswith("basic ") else ""
        except (binascii.Error, UnicodeDecodeError):
            password = ""
        verify_bearer(self._secret(), "Bearer " + password)  # the service hook's basic-auth password is the shared secret
        try:
            return str(json.loads(delivery.body)["id"])
        except (ValueError, KeyError, TypeError):
            return hashlib.sha256(delivery.body).hexdigest()

    def extract(self, headers, payload):
        event, resource = payload["eventType"], payload["resource"]
        if event == "workitem.created":
            fields = resource["fields"]
            title, desc = _text(fields.get("System.Title")), re.sub(r"<[^>]+>", " ", _text(fields.get("System.Description")))
            return Extracted(f"workitem/{resource['id']}", title, f"{title}\n{desc}", "created", _text((fields.get("System.CreatedBy") or {}).get("uniqueName")).lower(),
                             ((resource.get("_links") or {}).get("html") or {}).get("href"), tuple(t.strip() for t in _text(fields.get("System.Tags")).split(";") if t.strip()), body=desc.strip())
        if event == "workitem.commented":
            fields = resource["fields"]
            return Extracted(f"workitem/{resource['workItemId']}", _text(fields.get("System.Title")) or f"Work item {resource['workItemId']}", re.sub(r"<[^>]+>", " ", _text(fields.get("System.History"))),
                             f"comment:{resource.get('rev')}", _text((resource.get("revisedBy") or {}).get("uniqueName")).lower(), is_reply=True)
        return None


class Linear(SkeletonConnector):
    kind, secret_name, scopes = "linear", "linear-webhook-secret", ("read", "comments:create")

    def verify(self, delivery: Delivery) -> str:
        verify_hmac_sha256(self._secret().encode(), delivery.body, delivery.headers.get("linear-signature"), prefix="")
        try:
            stamp = float(json.loads(delivery.body)["webhookTimestamp"]) / 1000.0
        except (ValueError, KeyError, TypeError):
            raise Rejected("bad_payload", "missing webhook timestamp", 400) from None
        if not math.isfinite(stamp) or abs(self._now() - stamp) > 60:
            raise Rejected("stale", "webhook timestamp is outside the accepted window", 401)
        return delivery.headers.get("linear-delivery") or hashlib.sha256(delivery.body).hexdigest()

    def extract(self, headers, payload):
        data, kind = payload["data"], payload["type"]
        if kind == "Comment" and payload.get("action") == "create":
            issue = data["issue"]
            return Extracted(issue["identifier"].lower(), _text(issue.get("title")), _text(data.get("body")), f"comment:{data['id']}", _text((data.get("user") or {}).get("name")).lower(),
                             payload.get("url"), is_reply=True)
        if kind == "Issue" and payload.get("action") == "create":
            title = _text(data.get("title"))
            return Extracted(data["identifier"].lower(), title, f"{title}\n{_text(data.get('description'))}", "created", _text((data.get("creator") or {}).get("name")).lower(),
                             payload.get("url"), tuple(l["name"] for l in data.get("labels", [])), body=_text(data.get("description")))
        return None


class Jira(SkeletonConnector):
    kind, secret_name, scopes = "jira", "jira-webhook-secret", ("read:jira-work", "write:jira-work (comments)")

    def verify(self, delivery: Delivery) -> str:
        verify_hmac_sha256(self._secret().encode(), delivery.body, delivery.headers.get("x-hub-signature"))
        return delivery.headers.get("x-atlassian-webhook-identifier") or hashlib.sha256(delivery.body).hexdigest()

    def extract(self, headers, payload):
        event, issue = payload["webhookEvent"], payload["issue"]
        key, fields = issue["key"].lower(), issue.get("fields") or {}
        title = _text(fields.get("summary"))
        if event == "comment_created":
            comment = payload["comment"]
            return Extracted(key, title, _text(comment.get("body")), f"comment:{comment['id']}", _text((comment.get("author") or {}).get("accountId")).lower(), is_reply=True)
        if event == "jira:issue_created":
            return Extracted(key, title, f"{title}\n{_text(fields.get('description'))}", "created", _text((fields.get("creator") or {}).get("accountId")).lower(),
                             labels=tuple(str(l) for l in fields.get("labels", [])), body=_text(fields.get("description")))
        return None


class Slack(SkeletonConnector):
    kind, secret_name, scopes = "slack", "slack-signing-secret", ("app_mentions:read", "im:history", "chat:write")

    def verify(self, delivery: Delivery) -> str:
        stamp = delivery.headers.get("x-slack-request-timestamp", "")
        try:
            issued = float(stamp)
        except ValueError:
            raise Rejected("bad_signature", "missing or malformed timestamp", 401) from None
        if not math.isfinite(issued) or abs(self._now() - issued) > 300:
            raise Rejected("stale", "request timestamp is outside the accepted window", 401)
        verify_hmac_sha256(self._secret().encode(), b"v0:" + stamp.encode() + b":" + delivery.body, delivery.headers.get("x-slack-signature"), prefix="v0=")
        try:
            return str(json.loads(delivery.body)["event_id"])
        except (ValueError, KeyError, TypeError):
            return hashlib.sha256(delivery.body).hexdigest()

    def extract(self, headers, payload):
        if payload.get("type") != "event_callback":
            return None   # url_verification and the rest belong to the receiver, not to work
        event = payload["event"]
        if event.get("bot_id") or event.get("subtype"):
            return None
        direct = event.get("type") == "message" and event.get("channel_type") == "im"
        if event.get("type") != "app_mention" and not direct:
            return None
        thread = f"{event['channel']}:{event.get('thread_ts') or event['ts']}"
        return Extracted(thread.lower(), "Slack message", _text(event.get("text")), f"event:{payload['event_id']}", _text(event.get("user")).lower(), explicit=True, is_reply=True, thread_ref=thread)


class Teams(SkeletonConnector):
    kind, secret_name, scopes = "teams", "teams-webhook-secret", ("an outgoing webhook on the team (no extra Graph scopes for intake)",)

    def verify(self, delivery: Delivery) -> str:
        header = delivery.headers.get("authorization", "")
        try:
            key = base64.b64decode(self._secret(), validate=True)
        except (binascii.Error, ValueError):
            key = b""
        if not key:
            raise Rejected("no_secret", "no webhook secret is configured", 503)
        expected = base64.b64encode(hmac.new(key, delivery.body, hashlib.sha256).digest()).decode()
        if not header.startswith("HMAC ") or not hmac.compare_digest(header[5:].strip().encode("utf-8", "replace"), expected.encode()):
            raise Rejected("bad_signature", "signature does not match", 401)
        try:
            return str(json.loads(delivery.body)["id"])
        except (ValueError, KeyError, TypeError):
            return hashlib.sha256(delivery.body).hexdigest()

    def extract(self, headers, payload):
        if payload.get("type") != "message":
            return None
        text = re.sub(r"</?at>", "", _text(payload.get("text")))   # an outgoing webhook only fires on an @mention
        conversation = str(payload["conversation"]["id"])
        return Extracted(conversation.lower(), "Teams message", text, f"message:{payload['id']}", _text((payload.get("from") or {}).get("id")).lower(), explicit=True, is_reply=True, thread_ref=conversation)


CONNECTORS = {c.kind: c for c in (GitLab, AzureDevOps, Linear, Jira, Slack, Teams)}
