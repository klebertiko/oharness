"""Usage ledger + global budget — read/configure what `usage_tracking` and
`routers/execution.py` (the actual spend + enforcement path) already write.
This router is a read/write surface over that module, not a second source
of truth: every number here comes straight from `models.UsageRecord` /
`models.BudgetConfig` through `usage_tracking`'s own helpers.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import usage_tracking
from database import get_db
from models import UsageRecord

router = APIRouter(prefix="/usage", tags=["usage"])


class BudgetBody(BaseModel):
    limitUsd: float | None = None


def _status_json(status: usage_tracking.BudgetStatus) -> dict[str, Any]:
    return {
        "limitUsd": status.limit_usd,
        "spentUsd": round(status.spent_usd, 6),
        "remainingUsd": status.remaining_usd,
        "pct": status.pct,
        "state": status.state,
    }


@router.get("/budget")
async def get_budget(db: AsyncSession = Depends(get_db)):
    status = await usage_tracking.get_budget_status(db)
    return _status_json(status)


@router.put("/budget")
async def put_budget(body: BudgetBody, db: AsyncSession = Depends(get_db)):
    try:
        await usage_tracking.set_budget_limit(db, body.limitUsd)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    status = await usage_tracking.get_budget_status(db)
    return _status_json(status)


# Tokens billed at an unknown rate — `price_per_mtok IS NULL` — grouped
# alongside the priced total so a connection reads honestly: "free" (local,
# no catalog entry expected) and "cost unknown" (cloud, no catalog entry
# yet) are told apart by the frontend using the connection's `residence`,
# which this backend does not track on the ledger row itself (see
# `models.UsageRecord`'s docstring). Subscription tokens are counted apart:
# a seat has no USD price by design, so they never make USD cost incomplete
# and never appear as an invented dollar amount (I11, R-PRV-06).
_is_subscription = UsageRecord.billing == "subscription"
_unpriced_tokens = func.sum(
    case(
        (and_(UsageRecord.price_per_mtok.is_(None), or_(UsageRecord.billing.is_(None), ~_is_subscription)),
         UsageRecord.tokens_total),
        else_=0,
    )
)
_subscription_tokens = func.sum(case((_is_subscription, UsageRecord.tokens_total), else_=0))


@router.get("/summary")
async def get_summary(request: Request, db: AsyncSession = Depends(get_db)):
    totals = await db.execute(
        select(
            func.coalesce(func.sum(UsageRecord.tokens_total), 0),
            func.coalesce(func.sum(UsageRecord.cost_usd), 0.0),
            func.coalesce(_unpriced_tokens, 0),
            func.coalesce(_subscription_tokens, 0),
        )
    )
    total_tokens, total_cost, unpriced_tokens, subscription_tokens = totals.one()

    by_conn_result = await db.execute(
        select(
            UsageRecord.connection_id,
            UsageRecord.provider,
            func.sum(UsageRecord.tokens_total),
            func.sum(UsageRecord.cost_usd),
            _unpriced_tokens,
            _subscription_tokens,
        ).group_by(UsageRecord.connection_id, UsageRecord.provider)
    )
    by_connection = [
        {
            "connectionId": conn_id,
            "provider": provider,
            "tokensTotal": int(tokens or 0),
            "costUsd": round(float(cost or 0.0), 6),
            "unpricedTokens": int(unpriced or 0),
            "subscriptionTokens": int(subscription or 0),
            # A subscription connection's cost is unknown, never "$0.00" (I11).
            "costComplete": not (unpriced or subscription),
            "estimatedCostUsd": None if unpriced or subscription else float(cost or 0.0),
        }
        for conn_id, provider, tokens, cost, unpriced, subscription in by_conn_result.all()
        if conn_id is not None
    ]

    by_source_result = await db.execute(
        select(
            UsageRecord.source,
            func.sum(UsageRecord.tokens_total),
            func.sum(UsageRecord.cost_usd),
            _unpriced_tokens,
        ).group_by(UsageRecord.source)
    )
    by_source = [
        {"source": source, "tokensTotal": int(tokens or 0), "costUsd": round(float(cost or 0.0), 6),
         "costComplete": not bool(unpriced),
         "estimatedCostUsd": None if unpriced else float(cost or 0.0)}
        for source, tokens, cost, unpriced in by_source_result.all()
    ]

    budget_status = await usage_tracking.get_budget_status(db)

    return {
        "totalTokens": int(total_tokens or 0),
        "totalCostUsd": round(float(total_cost or 0.0), 6),
        "unpricedTokens": int(unpriced_tokens or 0),
        "subscriptionTokens": int(subscription_tokens or 0),
        "costComplete": not bool(unpriced_tokens),
        "estimatedCostUsd": None if unpriced_tokens else float(total_cost or 0.0),
        "budget": _status_json(budget_status),
        "byConnection": by_connection,
        "bySource": by_source,
    }
