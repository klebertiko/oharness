"""The one live-call helper behind Copilot and field assist (spec §5.2).

Mirrors `/execute/direct`'s chain — resolve the connection, gate on the
budget, invoke the adapter, record usage — with three deliberate differences:
the workspace is *never* passed (`cwd=None`, and any `cwd` the resolved config
carries is stripped), the reply must be a JSON object that passes the caller's
validator (one repair round, then 422), and a failed or invalid call still
records the tokens it spent.
"""
from __future__ import annotations

import asyncio
import dataclasses
import uuid
from collections.abc import Callable
from typing import Any

import anyio
from fastapi import HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

import usage_tracking
from adapters.base import AdapterResult
from providers.resolution import ProviderResolutionError, resolve_node_provider
from sandbox.secrets import redact

from .extract import extract_json

MAX_ATTEMPTS = 2  # first try plus one repair round
MAX_REPLY_TOKENS = 4096
TEMPERATURE = 0.2
_DETAIL_MAX = 300

Validate = Callable[[dict[str, Any]], "tuple[Any, str | None]"]


class StudioLlmError(HTTPException):
    """An HTTPException whose body is a top-level `{"error": ...}` JSON object.

    Routers turn it into a `JSONResponse(exc.body, status)`, because FastAPI's
    default handler would nest the body under `detail`.
    """

    def __init__(self, status_code: int, error: str, detail: str | None = None) -> None:
        self.body: dict[str, Any] = {"error": error}
        if detail:
            self.body["detail"] = detail
        super().__init__(status_code=status_code, detail=self.body)


def _safe_detail(text: str) -> str:
    """One redacted, bounded line: provider errors can echo keys, URLs and paths."""
    return " ".join(redact(text)[0].split())[:_DETAIL_MAX]


def _estimate(text: str) -> int:
    return max(1, len(text) // 4) if text else 0


async def complete_json(
    request: Request,
    db: AsyncSession,
    *,
    connection_id: str | None,
    system: str,
    user: str,
    validate: Validate,
    source: str,
    timeout_s: float,
    invalid_code: str = "plan_invalid",
) -> tuple[Any, int]:
    """Run one validated JSON completion. Returns `(validated value, total tokens)`."""
    if not connection_id:
        raise StudioLlmError(400, "provider_unavailable", "Connect a provider, or use the offline draft.")

    state = request.app.state
    connections = getattr(state, "provider_connections", {}) or {}
    try:
        resolved = resolve_node_provider(
            {"providerIds": [connection_id]},
            "llm",
            "Studio copilot",
            connections=connections,
            secrets_store=getattr(state, "secrets_store", None),
            cwd=None,
        )
    except ProviderResolutionError as exc:
        raise StudioLlmError(400, "provider_unavailable", _safe_detail(str(exc))) from exc

    connection = connections.get(resolved.connection_id, {})
    residence, billing = usage_tracking.connection_billing(connection)
    try:
        await usage_tracking.enforce_budget_or_raise(
            db,
            model=resolved.config.model or None,
            residence=residence,
            billing=billing,
            model_expected=True,
        )
    except usage_tracking.BudgetExceededError as exc:
        raise StudioLlmError(402, "budget_exceeded", _safe_detail(str(exc))) from exc

    base = resolved.config
    # Never hand a workspace to a Copilot turn, even if resolution one day carries one.
    extra = {k: v for k, v in base.extra.items() if k not in ("cwd", "cwd_root")}
    config = dataclasses.replace(
        base,
        system_prompt=system,
        temperature=TEMPERATURE,
        max_tokens=min(base.max_tokens or MAX_REPLY_TOKENS, MAX_REPLY_TOKENS),
        extra=extra,
    )

    tokens = 0
    tokens_estimated = False  # any attempt counted by length, not by the provider (#418)
    try:
        message = user
        problem = "no reply"
        for _ in range(MAX_ATTEMPTS):
            try:
                result: AdapterResult = await asyncio.wait_for(resolved.adapter.invoke(message, config), timeout_s)
            except asyncio.TimeoutError as exc:
                raise StudioLlmError(504, "provider_timeout", "The provider took too long to answer.") from exc
            except Exception as exc:  # noqa: BLE001 - adapters raise vendor-specific errors
                raise StudioLlmError(502, "provider_error", f"The provider call failed ({type(exc).__name__}).") from exc

            if result.tokens_used > 0:
                tokens += result.tokens_used
            else:
                tokens += _estimate(result.content)
                tokens_estimated = True
            if result.error:
                raise StudioLlmError(502, "provider_error", _safe_detail(result.error))

            obj = extract_json(result.content)
            if obj is None:
                problem = "the reply was not a JSON object"
            else:
                value, error = validate(obj)
                if error is None:
                    return value, tokens
                problem = error
            message = f"{user}\n\nYour previous reply was rejected: {problem}.\nReply with corrected JSON only."
        raise StudioLlmError(422, invalid_code, _safe_detail(problem))
    finally:
        # Real spend is recorded whether the call succeeded, failed validation or errored.
        if tokens > 0:
            with anyio.CancelScope(shield=True):  # a disconnecting client must not lose the ledger row
                await usage_tracking.record_usage(
                    db,
                    run_id=str(uuid.uuid4()),
                    node_id=None,
                    source=source,
                    connection_id=resolved.connection_id,
                    provider=connection.get("provider", ""),
                    adapter=resolved.adapter_name,
                    model=config.model,
                    tokens_total=tokens,
                    residence=residence,
                    billing=billing,
                    tokens_estimated=tokens_estimated,
                )
