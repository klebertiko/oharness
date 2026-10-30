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

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .config import WebhookConfig
from .connector import Delivery, TriggerRules
from .connectors.github import ConnectorError, GitHubConnector
from .deliveries import DeliveryLog
from .pipeline import deliver
from .port import MAX_BODY, MAX_COMMENT, MAX_TITLE, FactoryError, FactoryPort, ReleaseResult, SourceRef, WorkItemDraft, WorkState
from .security import DEFAULT_MAX_BODY_BYTES, RateLimiter, Rejected, ReplayGuard, verify_bearer, verify_hmac_sha256, verify_standard_webhooks
from .tokens import Client, ClientTokens

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
    """Handlers are plain ``def`` (run in the threadpool): the secrets store, the port and the delivery log do blocking I/O, and one slow
    call must not stall every other request. Only the body read, which needs the event loop, is ``async`` (a dependency)."""
    app = FastAPI(title="OHarness factory intake", docs_url=None, redoc_url=None, openapi_url=None)
    clients = ClientTokens(secrets_store)
    replay = ReplayGuard()
    hook_rate = RateLimiter(per_second=1.0, burst=60)            # 60 deliveries per minute per webhook
    failed_auth = RateLimiter(per_second=0.1, burst=20)          # its own budget: past it, a bad credential is answered 429, a good one still passes
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
    async def hook_context(name: str, request: Request) -> tuple[WebhookConfig, dict, bytes]:
        cfg = webhooks.get(name)
        if cfg is None or not cfg.enabled:
            raise Rejected("not_found", "no such webhook", 404)
        if not hook_rate.allow(name):  # in-memory only: a flood must not turn into disk writes
            raise Rejected("rate_limited", "too many deliveries", 429)
        try:
            body = await _read_body(request, max_body)
        except Rejected:
            declared = request.headers.get("content-length", "")
            await run_in_threadpool(log.record, name, "-", "rejected_size", int(declared) if declared.isdigit() else 0)
            raise
        return cfg, {k.lower(): v for k, v in request.headers.items()}, body

    def delivery_key(cfg: WebhookConfig, headers: dict, body: bytes) -> str:
        """What makes two deliveries the same. GitHub's id header is not covered by its signature, so GitHub deliveries are keyed by the signed
        body; Standard Webhooks ids are signed; otherwise the configured header, else the body (identical bodies are duplicates)."""
        digest = hashlib.sha256(body).hexdigest()
        if cfg.scheme == "github":
            return digest
        id_header = (cfg.delivery_id_header or ("webhook-id" if cfg.scheme == "standard" else "")).lower()
        return (headers.get(id_header) if id_header else None) or digest

    def github_items(cfg: WebhookConfig, headers: dict, payload, key: str) -> list[str]:
        gh = cfg.github
        if gh is None or not isinstance(payload, dict):
            return []
        connector = GitHubConnector(gh.repos, secrets_store, self_logins=gh.self_logins, webhook_secret_ref=cfg.secret_ref)
        rules = TriggerRules(handle=gh.handle, labels=gh.labels, allowed_authors=gh.allowed_authors)
        trigger = f"delivery-{headers.get('x-github-delivery') or key[:32]}"
        return [deliver(port, draft).item.id for draft in connector.parse_event(headers.get("x-github-event", ""), payload, trigger, rules)]

    @app.post("/hooks/{name}")
    def receive(name: str, context: tuple = Depends(hook_context)):
        cfg, headers, body = context
        try:
            authenticate_webhook(cfg, secrets_store, headers, body)
        except Rejected as exc:
            if not failed_auth.allow(name):
                raise Rejected("rate_limited", "too many failed attempts", 429) from None
            log.record(name, "-", "rejected_auth", len(body))
            raise exc
        key = delivery_key(cfg, headers, body)
        try:
            payload = json.loads(body)
        except (ValueError, UnicodeDecodeError):
            log.record(name, key, "rejected_json", len(body))
            raise Rejected("bad_json", "body is not valid JSON", 400) from None
        guard_key = f"{name}:{key}"  # per webhook: another webhook's identical body or id is not a replay of this one
        try:
            replay.check(guard_key)
        except Rejected as exc:
            if exc.code == "replay":
                log.record(name, key, "duplicate", len(body))
                return JSONResponse({"delivery_id": key, "duplicate": True}, status_code=202)
            raise
        try:
            items = github_items(cfg, headers, payload, key) if cfg.scheme == "github" else (generic_handler(cfg, headers, payload, key) if generic_handler else [])
        except Exception:
            replay.forget(guard_key)  # handling failed: let the sender retry this delivery
            raise
        log.record(name, key, "accepted", len(body), body.decode("utf-8", "replace"), items)
        return JSONResponse({"delivery_id": key}, status_code=202)

    # -- integration API ----------------------------------------------------------------------------------------------------------
    def api(scope: str):
        """Dependency: authenticate and authorize first, then read the (size-limited) body."""
        async def dependency(request: Request) -> tuple[Client, bytes]:
            def check() -> Client:
                client = clients.authenticate(request.headers.get("authorization"))
                api_rate.require(client.name)
                client.require(scope)
                return client

            client = await run_in_threadpool(check)
            return client, await _read_body(request, max_body)
        return dependency

    def parsed(raw: bytes, model):
        try:
            return model.model_validate_json(raw or b"{}")
        except ValidationError:
            raise Rejected("invalid_request", "the request body is not valid", 422) from None

    def view(item) -> dict:
        return json.loads(item.model_dump_json())

    def owned(client: Client, item) -> bool:
        return item.source.kind == client.source_kind and item.source.ref.startswith(f"{client.name}:")

    @app.post("/api/work-items")
    def create(ctx: tuple = Depends(api("work:write"))):
        client, raw = ctx
        data = parsed(raw, CreateBody)
        # refs and keys are namespaced per client: two clients of one kind cannot collide, replay or answer into each other's items
        draft = WorkItemDraft(source=SourceRef(kind=client.source_kind, ref=f"{client.name}:{data.ref or uuid.uuid4().hex}"[:200]), title=data.title, body=data.body,
                              labels=tuple(label[:100] for label in data.labels), requested_by=f"client:{client.name}",
                              idempotency_key=f"{client.name}:{data.idempotency_key or uuid.uuid4().hex}"[:200])
        result = deliver(port, draft)
        return JSONResponse({"outcome": result.outcome, "item": view(result.item)}, status_code=201 if result.outcome == "created" else 200)

    @app.get("/api/work-items")
    def list_items(state: WorkState | None = None, limit: int = 50, ctx: tuple = Depends(api("work:read"))):
        return {"items": [view(i) for i in port.list(state, None, max(1, min(limit, 200)))]}

    @app.get("/api/work-items/{item_id}")
    def get_item(item_id: str, ctx: tuple = Depends(api("work:read"))):
        return view(port.get(item_id))

    @app.post("/api/work-items/{item_id}/comments")
    def comment(item_id: str, ctx: tuple = Depends(api("work:write"))):
        client, raw = ctx
        data = parsed(raw, CommentBody)
        port.comment(item_id, data.text, f"client:{client.name}")
        return JSONResponse({"ok": True}, status_code=201)

    @app.post("/api/work-items/{item_id}/cancel")
    def cancel(item_id: str, ctx: tuple = Depends(api("work:write"))):
        client, _ = ctx
        if not owned(client, port.get(item_id)):  # an integration cancels what it created, not GitHub's or another client's work
            raise Rejected("forbidden", "this token can only cancel items it created", 403)
        return view(port.cancel(item_id))

    @app.post("/api/work-items/{item_id}/claim")
    def claim(item_id: str, ctx: tuple = Depends(api("work:claim"))):
        client, raw = ctx
        data = parsed(raw, ClaimBody)
        return view(port.claim(item_id, f"{client.name}/{data.holder}"[:100]))

    @app.post("/api/work-items/{item_id}/release")
    def release(item_id: str, ctx: tuple = Depends(api("work:claim"))):
        client, raw = ctx
        data = parsed(raw, ReleaseResult)
        item = port.get(item_id)
        if item.claim is None or not item.claim.holder.startswith(f"{client.name}/"):  # only the client that claimed it can give it back
            raise Rejected("not_holder", "this token does not hold the claim on this item", 409)
        return view(port.release(item_id, data))

    @app.get("/api/metrics")
    def metrics(window_days: int = 7, ctx: tuple = Depends(api("work:read"))):
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
