"""
Usage ledger + global spend budget.

Two independent concerns share this module because they share the same
arithmetic (`cost = tokens x price / 1,000,000`) and the same table
(`models.UsageRecord`):

1. **Recording** what a completed node/turn actually cost — `record_usage`
   / `record_usage_rows`, called once a run's outcome is already known
   (`routers/execution.py`'s `event_stream()` finally-block). Real spend
   only: a `mock`/`unresolved` adapter or a turn with zero measurable tokens
   writes nothing, so this table stays a "real usage" source of truth the
   Providers screen can show without ever mixing in a synthetic number.

2. **Enforcing** the one global USD ceiling every real spend path must
   check before it starts (`enforce_budget_or_raise`) — chat, harness runs,
   direct turns, regardless of which agent or provider is about to run.

Enforcement thresholds (per product decision, not yet asked of the user
directly — documented here and in the handoff): warn, non-blocking, at 80%
of the configured budget; hard-stop, refuse the new run, at/over 100%. The
same two constants apply to the per-agent token limit enforced in
`engine.py`'s node loop, which is why `WARN_THRESHOLD` is exported rather
than re-declared there.
"""
from __future__ import annotations

import asyncio
import math
import json
import uuid
from dataclasses import dataclass
from contextlib import asynccontextmanager
from weakref import WeakKeyDictionary

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from adapters.catalog import get_model_price
from models import BudgetConfig, UsageRecord

WARN_THRESHOLD = 0.8

# A hard stop must never be eroded by float-summation drift (e.g. fifty
# $0.10 charges landing on 4.999999999999998 instead of 5.0 in raw IEEE 754
# addition) — subtracting a tiny epsilon from the limit before comparing
# biases the boundary toward blocking one run too early rather than letting
# one slip through at the exact ceiling.
_EPSILON = 1e-9

_BUDGET_ROW_ID = "global"

# Adapters that never reach a real vendor. A ledger row for either would be
# exactly the "synthetic number in a real-usage table" mistake this feature
# must not make.
_NO_SPEND_ADAPTERS = {"mock", "unresolved", ""}

# Serialises the read-then-decide step of `enforce_budget_or_raise` for
# callers inside this one process (the sidecar is a single FastAPI process;
# this is not a multi-process/multi-tenant guarantee — see that function's
# docstring for the exact scope of what this does and does not close).
_budget_lock = asyncio.Lock()


class BudgetExceededError(Exception):
    """The global USD ceiling is already at or over its limit."""


def blended_price_per_mtok(model: str) -> float | None:
    """Average of the catalog's [input, output] $/Mtok — see
    `models.UsageRecord`'s docstring for why a blend, not an exact split."""
    price = get_model_price(model)
    if not price:
        return None
    return (price[0] + price[1]) / 2


def compute_cost(tokens_total: int, model: str) -> tuple[float | None, float | None]:
    """`(cost_usd, price_per_mtok_used)` for `tokens_total` tokens of
    `model`, at today's blended catalog rate. Store without per-row rounding;
    only display boundaries round the estimate."""
    price = blended_price_per_mtok(model)
    if tokens_total <= 0:
        return 0.0, price
    if price is None:
        return None, None
    return tokens_total * price / 1_000_000, price


async def record_usage(
    db: AsyncSession,
    *,
    run_id: str,
    node_id: str | None,
    source: str,
    connection_id: str | None,
    provider: str,
    adapter: str,
    model: str,
    tokens_total: int,
    call_id: str | None = None,
    residence: str | None = None,
    billing: str | None = None,
) -> UsageRecord | None:
    """Persist one ledger row for one completed node/turn.

    Returns None (and writes nothing) for a turn with no measurable real
    spend: `mock`/`unresolved` never reached a real vendor, and zero tokens
    means nothing was actually returned to bill for — recording either
    would misrepresent what was actually spent, the same principle that
    keeps `cost_usd` frozen at write time below.
    """
    if tokens_total <= 0 or adapter in _NO_SPEND_ADAPTERS:
        return None
    if residence == "local" and billing == "none":
        cost_usd, price_per_mtok = 0.0, 0.0
    elif billing == "subscription":
        cost_usd, price_per_mtok = None, None
    else:
        cost_usd, price_per_mtok = compute_cost(tokens_total, model)
    row = UsageRecord(
        run_id=run_id,
        node_id=node_id,
        source=source,
        connection_id=connection_id,
        provider=provider,
        adapter=adapter,
        model=model,
        tokens_total=tokens_total,
        price_per_mtok=price_per_mtok,
        cost_usd=cost_usd if cost_usd is not None else 0.0,
    )
    if call_id is not None:
        if not call_id.strip():
            raise ValueError("call_id must be nonempty when supplied")
        row.id = str(uuid.uuid5(uuid.NAMESPACE_URL, json.dumps(["oharness-usage", run_id, call_id])))
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        if call_id is None:
            raise
        existing = await db.get(UsageRecord, row.id)
        if existing is None:
            raise
        return existing
    return row


async def record_usage_rows(db: AsyncSession, rows: list[dict]) -> list[UsageRecord]:
    """Batch form of `record_usage` — one commit per row (a harness run is
    already a handful of nodes at most, and each row's cost must be
    computed from a consistent, single point-in-time catalog read; this
    trades a little throughput for that simplicity, which is the right
    trade at this scale)."""
    written: list[UsageRecord] = []
    for kwargs in rows:
        row = await record_usage(db, **kwargs)
        if row is not None:
            written.append(row)
    return written


async def total_spend_usd(db: AsyncSession) -> float:
    """Sum of every real-usage row ever recorded — the whole point of a
    *global* budget is that it is never scoped to one run, one provider, or
    one mode."""
    result = await db.execute(select(func.coalesce(func.sum(UsageRecord.cost_usd), 0.0)))
    return float(result.scalar_one())


async def get_budget_limit(db: AsyncSession) -> float | None:
    row = await db.get(BudgetConfig, _BUDGET_ROW_ID)
    return row.limit_usd if row else None


async def set_budget_limit(db: AsyncSession, limit_usd: float | None) -> float | None:
    """`None` clears the budget (back to "no budget set"). A negative number
    is rejected outright — it can never be a meaningful ceiling — but `0` is
    accepted and deliberately means "block all spending", not "unset"."""
    if limit_usd is not None and (not math.isfinite(limit_usd) or limit_usd < 0):
        raise ValueError("Budget must be a finite, nonnegative USD amount.")
    row = await db.get(BudgetConfig, _BUDGET_ROW_ID)
    if row is None:
        row = BudgetConfig(id=_BUDGET_ROW_ID)
        db.add(row)
    row.limit_usd = limit_usd
    await db.commit()
    return row.limit_usd


@dataclass(frozen=True, slots=True)
class BudgetStatus:
    limit_usd: float | None
    spent_usd: float
    remaining_usd: float | None
    pct: float | None
    state: str  # "unset" | "ok" | "warning" | "exceeded"


def _status_from(limit_usd: float | None, spent_usd: float) -> BudgetStatus:
    if limit_usd is not None and (not math.isfinite(limit_usd) or limit_usd < 0):
        return BudgetStatus(None, spent_usd, None, None, "invalid")
    if limit_usd is None:
        return BudgetStatus(None, spent_usd, None, None, "unset")
    if limit_usd <= 0:
        # An explicit $0 ceiling reads as "no spending allowed at all",
        # exceeded from the moment it is set — not "unset" (that is `None`,
        # a genuinely different state) and not "ok" just because nothing
        # has been spent yet under it.
        return BudgetStatus(limit_usd, spent_usd, 0.0, 1.0, "exceeded")
    pct = spent_usd / limit_usd
    remaining = max(0.0, limit_usd - spent_usd)
    if spent_usd >= limit_usd - _EPSILON:
        state = "exceeded"
    elif pct >= WARN_THRESHOLD:
        state = "warning"
    else:
        state = "ok"
    return BudgetStatus(limit_usd, spent_usd, remaining, pct if math.isfinite(pct) else None, state)


async def get_budget_status(db: AsyncSession) -> BudgetStatus:
    limit_usd = await get_budget_limit(db)
    spent_usd = await total_spend_usd(db)
    status = _status_from(limit_usd, spent_usd)
    if limit_usd is not None and status.state not in {"invalid", "exceeded"}:
        unknown = await db.scalar(select(func.count()).select_from(UsageRecord).where(
            UsageRecord.price_per_mtok.is_(None), UsageRecord.tokens_total > 0
        ))
        if unknown:
            return BudgetStatus(limit_usd, spent_usd, None, None, "unknown")
    return status


async def enforce_budget_or_raise(
    db: AsyncSession,
    *,
    model: str | None = None,
    residence: str | None = None,
    model_expected: bool = False,
    billing: str | None = None,
) -> BudgetStatus:
    """Call before any real spend can start — a harness run, a direct turn,
    *and* the triage routing call that decides between them, since that
    call already spends real tokens too. Raises `BudgetExceededError` when
    the ceiling is already at/over 100%; otherwise returns the status as-is
    (including "warning") so the caller can still surface a non-blocking
    heads-up at 80% without treating it as a refusal.

    `model`/`residence` are optional and describe the connection about to be
    used, when the caller already knows it (best-effort — a harness graph
    may not have a provider-pinned node yet, in which case the caller should
    pass neither). When a budget **is** configured (`limit_usd is not None`)
    and the model's price is not in the catalog (`compute_cost`/
    `blended_price_per_mtok` return `None` for it) and the connection is not
    a genuinely-free local one, this also refuses — SEC P2-4: without this,
    an uncatalogued-but-paid model always recorded $0.00 real cost, so a
    configured ceiling never saw it and never blocked it, silently
    defeating the one control this feature exists to provide. A *local*
    residence is exempt because an unpriced local model really is free, not
    merely unknown (see `models.UsageRecord`'s docstring for why those two
    cases look identical on the ledger row itself and must be told apart by
    the caller). This check is independent of `state` (it can fire at "ok",
    not just "warning"/"exceeded") because the problem isn't how much has
    been spent — it's that this run's spend would be invisible to the
    ceiling regardless of how much room is left under it. When no budget is
    configured, or no model/residence was passed, nothing here changes the
    existing unrestricted behaviour.

    `model_expected` distinguishes two different reasons `model` can be
    falsy. Default `False` — the pre-run gates (no node resolved yet, so
    nothing is known) — treats an absent model the same as "caller didn't
    check", same as always. Callers past a real per-node resolution (only
    `engine.py`'s node loop today) pass `True`: a connection has already
    been picked for this node, so an empty `model` there means a CLI
    adapter with no `defaultModel` configured, about to fall back to its
    own internal default this function never sees — the single least-known
    case there is, not the most harmless one (found in QA re-review,
    2026-09-15: OpenAI connections routinely hit exactly this, silently
    bypassing the P2-4 fix's first version). Treated identically to an
    uncatalogued model: refused when a budget is set and residence isn't
    local.

    This check alone reserves nothing. Its race window lasts until usage
    is committed, potentially the entire run, and concurrent overshoot is
    unbounded. Adopt budget_call around each invocation and its persistence
    to serialize participating callers in the sidecar event loop.
    """
    async with _budget_lock:
        status = await get_budget_status(db)
        if status.state == "unknown":
            raise BudgetExceededError("Recorded usage has unknown cost; USD budget cannot be enforced.")
        if status.state == "invalid":
            raise BudgetExceededError("Global budget is invalid; configure a finite USD limit.")
        if status.state == "exceeded":
            limit_text = f"${status.limit_usd:,.2f}" if status.limit_usd is not None else "$0.00"
            raise BudgetExceededError(
                f"Global budget of {limit_text} has been reached (spent "
                f"${status.spent_usd:,.2f} so far). Raise or clear the budget "
                f"under Providers to keep running."
            )
        if status.limit_usd is not None and billing == "subscription":
            raise BudgetExceededError("Cannot enforce USD budget for subscription billing; price and balance are unknown.")
        if status.limit_usd is not None and not (residence == "local" and billing in (None, "none")):
            if model:
                if blended_price_per_mtok(model) is None:
                    raise BudgetExceededError(
                        f"A budget of ${status.limit_usd:,.2f} is configured, but the price "
                        f"for model '{model}' is not in the catalog, so this run's spend "
                        f"could not be counted toward it. Refusing to start rather than run "
                        f"un-enforced — add a catalog price for this model, choose a priced "
                        f"one, or clear the budget under Providers to run it anyway."
                    )
            elif model_expected:
                raise BudgetExceededError(
                    f"A budget of ${status.limit_usd:,.2f} is configured, but this node's "
                    f"connection has no default model set, so this run's spend could not "
                    f"be counted toward it. Refusing to start rather than run un-enforced — "
                    f"set a default model for this connection under Providers, or clear the "
                    f"budget to run it anyway."
                )
        return status


_call_locks: WeakKeyDictionary = WeakKeyDictionary()


@asynccontextmanager
async def budget_call(
    db: AsyncSession,
    *,
    model: str | None,
    residence: str | None,
    billing: str | None,
):
    """Serialize check -> one invocation -> durable usage in one event loop.

    Callers must persist measured usage in a finally block *inside* this
    context, including failed/cancelled calls. Use a fresh dedicated session.
    Do not nest contexts. This is not a reservation or a provider-enforced
    ceiling: one call can overshoot, and other processes/legacy callers do
    not participate. Missing measurement must not be invented as zero.
    """
    loop = asyncio.get_running_loop()
    lock = _call_locks.setdefault(loop, asyncio.Lock())
    async with lock:
        status = await enforce_budget_or_raise(
            db, model=model, residence=residence, billing=billing, model_expected=True
        )
        yield status
