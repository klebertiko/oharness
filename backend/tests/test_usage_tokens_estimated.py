"""#418: the ledger marks a row as estimated only when the count did not come
from the provider/CLI (a length-based fallback). Runs against the real models,
migration and row assembly."""
from __future__ import annotations

import anyio
from sqlalchemy import create_engine, delete, select, text

from database import SessionLocal, _migrate_usage_records, init_db
from models import UsageRecord
from routers.execution import _usage_rows_from_events
import usage_tracking

# The post-#416 shape: has `billing`, lacks `tokens_estimated`.
_POST416_DDL = """
CREATE TABLE usage_records (
    id VARCHAR NOT NULL PRIMARY KEY,
    run_id VARCHAR NOT NULL,
    node_id VARCHAR,
    source VARCHAR(16),
    connection_id VARCHAR,
    provider VARCHAR(64),
    adapter VARCHAR(64),
    model VARCHAR(255),
    tokens_total INTEGER,
    price_per_mtok FLOAT,
    cost_usd FLOAT,
    billing VARCHAR(16),
    created_at DATETIME DEFAULT (CURRENT_TIMESTAMP)
)
"""


def test_post416_table_gains_tokens_estimated_defaulting_to_false(tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'ledger.db').as_posix()}")
    with engine.begin() as conn:
        conn.execute(text(_POST416_DDL))
        conn.execute(text(
            "INSERT INTO usage_records (id, run_id, adapter, tokens_total, cost_usd, billing) "
            "VALUES ('a', 'r1', 'claude', 10, NULL, 'subscription')"
        ))
    with engine.begin() as conn:
        _migrate_usage_records(conn)
        _migrate_usage_records(conn)  # idempotent
    with engine.begin() as conn:
        cols = {r[1] for r in conn.execute(text("PRAGMA table_info(usage_records)"))}
        row = conn.execute(text("SELECT tokens_estimated, billing FROM usage_records WHERE id='a'")).one()
    assert "tokens_estimated" in cols
    assert row.tokens_estimated == 0  # an old row is not claimed as an estimate
    assert row.billing == "subscription"


def test_model_has_tokens_estimated_column():
    col = UsageRecord.__table__.c["tokens_estimated"]
    assert col.nullable is False


async def _record(**over) -> UsageRecord | None:
    await init_db()
    async with SessionLocal() as db:
        await db.execute(delete(UsageRecord))
        await db.commit()
        kwargs = dict(
            run_id="r", node_id="n", source="direct", connection_id="openrouter",
            provider="openrouter", adapter="openrouter", model="anthropic/claude-opus-5",
            tokens_total=100, residence="cloud", billing="credits",
        )
        kwargs.update(over)
        await usage_tracking.record_usage(db, **kwargs)
        row = (await db.execute(select(UsageRecord))).scalars().first()
        await db.execute(delete(UsageRecord))
        await db.commit()
        return row


def test_record_usage_stores_the_estimate_flag():
    assert anyio.run(lambda: _record(tokens_estimated=True)).tokens_estimated is True
    assert anyio.run(lambda: _record(tokens_estimated=False)).tokens_estimated is False
    # Omitted: the caller had the provider's own count.
    assert anyio.run(lambda: _record()).tokens_estimated is False


def test_rows_from_events_carry_the_node_done_flag():
    conns = {"anthropic": {"id": "anthropic", "provider": "anthropic", "residence": "cloud"}}
    events = [
        {"event": "node_start", "data": {"node_id": "a", "adapter": "claude", "model": "", "connection_id": "anthropic"}},
        {"event": "node_done", "data": {"node_id": "a", "tokens": 50, "tokens_estimated": False, "model": "claude-sonnet-5"}},
        {"event": "node_start", "data": {"node_id": "b", "adapter": "claude", "model": "", "connection_id": "anthropic"}},
        {"event": "node_done", "data": {"node_id": "b", "tokens": 12, "tokens_estimated": True}},
        {"event": "node_start", "data": {"node_id": "c", "adapter": "claude", "model": "", "connection_id": "anthropic"}},
        {"event": "node_error", "data": {"node_id": "c", "tokens": 7}},
    ]
    rows = {r["node_id"]: r for r in _usage_rows_from_events(events, run_id="r", source="harness", connections=conns)}
    assert rows["a"]["tokens_estimated"] is False
    assert rows["b"]["tokens_estimated"] is True
    # A node_error without the flag says nothing about provenance: not claimed as reported.
    assert rows["c"]["tokens_estimated"] is True
