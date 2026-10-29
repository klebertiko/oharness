"""The intake server (ADR 0061): ``/hooks/{name}`` for webhooks and ``/api/...`` for integrations, and nothing else.

It is a separate app from the sidecar on purpose: exposing this port (the owner's tunnel, for GitHub) never exposes the sidecar's routes.
Every request is authenticated before its body is parsed, sized and rate limited; texts it carries are untrusted data and only ever become
work items or comments (``pipeline.deliver``). It never merges and never pushes.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from typing import Callable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .config import WebhookConfig
from .connector import Delivery, TriggerRules
from .connectors.github import ConnectorError, GitHubConnector
from .deliveries import DeliveryLog
from .pipeline import deliver
from .port import MAX_BODY, MAX_COMMENT, MAX_TITLE, FactoryError, FactoryPort, ReleaseResult, SourceRef, WorkItemDraft, WorkState
from .security import DEFAULT_MAX_BODY_BYTES, RateLimiter, Rejected, ReplayGuard, verify_bearer, verify_hmac_sha256, verify_standard_webhooks
from .tokens import ClientTokens

# (webhook, headers, payload, delivery id) -> work item ids it started. Automations (ADR 0062) plug in here; with none, a generic webhook
# starts nothing on its own, as in the ADR: a delivery is recorded and an automation has to subscribe to it.
GenericHandler = Callable[[WebhookConfig, dict, object, str], list[str]]


class CreateBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=MAX_TITLE)
    body: str = Field(default="", max_length=MAX_BODY)
    labels: list[str] = Field(default_factory=list, max_length=50)
    ref: str | None = Field(default=None, max_length=200)
    idempotency_key: str | None = Field(default=None, max_length=200)


class CommentBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=MAX_COMMENT)


class ClaimBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    holder: str = Field(min_length=1, max_length=100)


def _error(code: str, message: str, status: int, headers: dict | None = None) -> JSONResponse:
    return JSONResponse({"code": code, "message": message}, status_code=status, headers=headers)


async def _read_body(request: Request, limit: int) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise Rejected("too_large", f"body exceeds {limit} bytes", 413)
    chunks, total = [], 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            raise Rejected("too_large", f"body exceeds {limit} bytes", 413)
        chunks.append(chunk)
    return b"".join(chunks)


def authenticate_webhook(cfg: WebhookConfig, secrets_store, headers: dict, body: bytes) -> None:
    secret = secrets_store.get(cfg.secret_ref) or ""
    if cfg.auth_mode == "token":
        verify_bearer(secret, headers.get("authorization"))
    elif cfg.scheme == "github":
        verify_hmac_sha256(secret.encode(), body, headers.get("x-hub-signature-256"))
    elif cfg.scheme == "generic":
        verify_hmac_sha256(secret.encode(), body, headers.get("x-oharness-signature"))
    else:
        verify_standard_webhooks(secret, headers, body)


def create_app(port: FactoryPort, secrets_store, webhooks: dict[str, WebhookConfig], log: DeliveryLog, *,
               generic_handler: GenericHandler | None = None, max_body: int = DEFAULT_MAX_BODY_BYTES) -> FastAPI:
    app = FastAPI(title="OHarness factory intake", docs_url=None, redoc_url=None, openapi_url=None)
    clients = ClientTokens(secrets_store)
    replay = ReplayGuard()
    hook_rate = RateLimiter(per_second=1.0, burst=60)            # 60 deliveries per minute per webhook
    failed_auth = RateLimiter(per_second=0.1, burst=20)          # its own budget for bad credentials
    api_rate = RateLimiter(per_second=10.0, burst=30)

    @app.exception_handler(Rejected)
    async def _rejected(_request, exc: Rejected):
        return _error(exc.code, exc.message, exc.status, {"Retry-After": "60"} if exc.status == 429 else None)

    @app.exception_handler(FactoryError)
    async def _factory_error(_request, exc: FactoryError):
        return _error(exc.code, exc.message, 404 if exc.code == "not_found" else 409)

    @app.exception_handler(ConnectorError)
    async def _connector_error(_request, exc: ConnectorError):
        return _error("connector_error", str(exc), 502)

    @app.exception_handler(Exception)
    async def _unexpected(_request, _exc: Exception):  # never a traceback or request content on the wire
        return _error("internal_error", "unexpected error", 500)

    # -- webhooks ------------------------------------------------------------------------------------------------------------------
    def github_items(cfg: WebhookConfig, headers: dict, body: bytes) -> list[str]:
        gh = cfg.github
        if gh is None:
            return []
        connector = GitHubConnector(gh.repos, secrets_store, self_logins=gh.self_logins, webhook_secret_ref=cfg.secret_ref)
        rules = TriggerRules(handle=gh.handle, labels=gh.labels, allowed_authors=gh.allowed_authors)
        return [deliver(port, draft).item.id for draft in connector.parse(Delivery(headers, body), rules)]

    @app.post("/hooks/{name}")
    async def receive(name: str, request: Request):
        cfg = webhooks.get(name)
        if cfg is None or not cfg.enabled:
            return _error("not_found", "no such webhook", 404)
        headers = {k.lower(): v for k, v in request.headers.items()}
        body, delivery_id = b"", "-"
        if not hook_rate.allow(name):
            log.record(name, "-", "rejected_rate", 0)
            raise Rejected("rate_limited", "too many deliveries", 429)
        if failed_auth.blocked(name):
            raise Rejected("rate_limited", "too many failed attempts", 429)
        try:
            body = await _read_body(request, max_body)
        except Rejected:
            declared = headers.get("content-length", "")
            log.record(name, "-", "rejected_size", int(declared) if declared.isdigit() else 0)
            raise
        id_header = (cfg.delivery_id_header or {"github": "x-github-delivery", "standard": "webhook-id"}.get(cfg.scheme or "", "")).lower()
        delivery_id = (headers.get(id_header) if id_header else None) or hashlib.sha256(body).hexdigest()  # no sender id: identical bodies are duplicates
        try:
            authenticate_webhook(cfg, secrets_store, headers, body)
        except Rejected:
            failed_auth.allow(name)
            log.record(name, "-", "rejected_auth", len(body))
            raise
        try:
            payload = json.loads(body)
        except (ValueError, UnicodeDecodeError):
            log.record(name, delivery_id, "rejected_json", len(body))
            raise Rejected("bad_json", "body is not valid JSON", 400) from None
        try:
            replay.check(delivery_id)
        except Rejected as exc:
            if exc.code == "replay":
                log.record(name, delivery_id, "duplicate", len(body))
                return JSONResponse({"delivery_id": delivery_id, "duplicate": True}, status_code=202)
            raise
        try:
            items = github_items(cfg, headers, body) if cfg.scheme == "github" else (generic_handler(cfg, headers, payload, delivery_id) if generic_handler else [])
        except Exception:
            replay.forget(delivery_id)  # handling failed: let the sender retry this delivery
            raise
        log.record(name, delivery_id, "accepted", len(body), body.decode("utf-8", "replace"), items)
        return JSONResponse({"delivery_id": delivery_id}, status_code=202)

    # -- integration API ----------------------------------------------------------------------------------------------------------
    def authorize(request: Request, scope: str):
        client = clients.authenticate(request.headers.get("authorization"))
        api_rate.require(client.name)
        client.require(scope)
        return client

    async def parsed(request: Request, model):
        raw = await _read_body(request, max_body)
        try:
            return model.model_validate_json(raw or b"{}")
        except ValidationError:
            raise Rejected("invalid_request", "the request body is not valid", 422) from None

    def view(item) -> dict:
        return json.loads(item.model_dump_json())

    @app.post("/api/work-items")
    async def create(request: Request):
        client = authorize(request, "work:write")
        data = await parsed(request, CreateBody)
        draft = WorkItemDraft(source=SourceRef(kind=client.source_kind, ref=data.ref or f"api:{uuid.uuid4().hex}"), title=data.title, body=data.body,
                              labels=tuple(label[:100] for label in data.labels), requested_by=f"client:{client.name}",
                              idempotency_key=data.idempotency_key or uuid.uuid4().hex)
        result = deliver(port, draft)
        return JSONResponse({"outcome": result.outcome, "item": view(result.item)}, status_code=201 if result.outcome == "created" else 200)

    @app.get("/api/work-items")
    async def list_items(request: Request, state: WorkState | None = None, limit: int = 50):
        authorize(request, "work:read")
        return {"items": [view(i) for i in port.list(state, None, max(1, min(limit, 200)))]}

    @app.get("/api/work-items/{item_id}")
    async def get_item(item_id: str, request: Request):
        authorize(request, "work:read")
        return view(port.get(item_id))

    @app.post("/api/work-items/{item_id}/comments")
    async def comment(item_id: str, request: Request):
        client = authorize(request, "work:write")
        data = await parsed(request, CommentBody)
        port.comment(item_id, data.text, f"client:{client.name}")
        return JSONResponse({"ok": True}, status_code=201)

    @app.post("/api/work-items/{item_id}/cancel")
    async def cancel(item_id: str, request: Request):
        authorize(request, "work:write")
        return view(port.cancel(item_id))

    @app.post("/api/work-items/{item_id}/claim")
    async def claim(item_id: str, request: Request):
        authorize(request, "work:claim")
        data = await parsed(request, ClaimBody)
        return view(port.claim(item_id, data.holder))

    @app.post("/api/work-items/{item_id}/release")
    async def release(item_id: str, request: Request):
        authorize(request, "work:claim")
        data = await parsed(request, ReleaseResult)
        return view(port.release(item_id, data))

    @app.get("/api/metrics")
    async def metrics(request: Request, window_days: int = 7):
        authorize(request, "work:read")
        return port.metrics(max(1, min(window_days, 365)))

    return app


def is_loopback(host: str) -> bool:
    import ipaddress

    name = host.strip("[]")
    if name == "localhost":
        return True
    try:
        return ipaddress.ip_address(name).is_loopback
    except ValueError:
        return False


def serve(host: str, port_number: int, directory, allow_remote: bool = False) -> int:  # pragma: no cover - thin wiring, exercised by hand
    import sys

    from .config import ConfigError, load_webhooks
    from .loader import FoundationMissing, load_port

    loopback = is_loopback(host)
    if not loopback and not allow_remote:
        print("serve refused: binding beyond loopback needs --allow-remote (and your own authenticated tunnel or proxy)", file=sys.stderr)
        return 2
    try:
        webhooks = load_webhooks(directory)
        factory_port = load_port()
    except (ConfigError, FoundationMissing) as exc:
        print(f"serve refused: {exc}", file=sys.stderr)
        return 2
    import os

    from secret_store.factory import build_secrets_store

    if os.environ.get("OH_SECRETS", "memory").strip().lower() in ("", "memory", "mem"):
        print("serve refused: set OH_SECRETS=file or keychain (an in-memory store cannot hold the webhook secrets and client tokens)", file=sys.stderr)
        return 2
    store = build_secrets_store()
    missing = [w.name for w in webhooks.values() if w.enabled and not store.exists(w.secret_ref)]
    if missing and not loopback:
        print(f"serve refused: no secret stored for webhook(s) {', '.join(missing)}", file=sys.stderr)
        return 2
    from pathlib import Path

    import uvicorn

    data = Path(os.environ.get("OH_DATA_DIR") or Path.home() / ".oharness")
    data.mkdir(parents=True, exist_ok=True)
    app = create_app(factory_port, store, webhooks, DeliveryLog(data / "factory_intake.db"))
    print(f"factory intake listening on {host}:{port_number} ({len(webhooks)} webhook(s))", file=sys.stderr)
    uvicorn.run(app, host=host.strip("[]"), port=port_number, log_level="warning")
    return 0
