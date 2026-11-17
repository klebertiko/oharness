"""#416: a pre-existing ledger table gains `billing` and a nullable `cost_usd`,
and legacy rows from the subscription CLI adapters stop carrying an invented
API price (F5). Runs the real migration against a throwaway SQLite file."""
from __future__ import annotations

from sqlalchemy import create_engine, text

from database import _migrate_usage_records

_LEGACY_DDL = """
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
    cost_usd FLOAT NOT NULL,
    created_at DATETIME DEFAULT (CURRENT_TIMESTAMP)
)
"""


def _engine(tmp_path):
    return create_engine(f"sqlite:///{(tmp_path / 'legacy.db').as_posix()}")


def test_legacy_table_is_rebuilt_and_cli_rows_become_subscription(tmp_path):
    engine = _engine(tmp_path)
    with engine.begin() as conn:
        conn.execute(text(_LEGACY_DDL))
        conn.execute(text(
            "INSERT INTO usage_records (id, run_id, source, connection_id, provider, adapter, model, "
            "tokens_total, price_per_mtok, cost_usd) VALUES "
            "('a', 'r1', 'direct', 'anthropic', 'anthropic', 'claude', 'claude-sonnet-5', 1000, 9.0, 0.009),"
            "('b', 'r2', 'direct', 'openrouter', 'openrouter', 'openrouter', 'anthropic/claude-opus-5', 1000, 45.0, 0.045)"
        ))
    with engine.begin() as conn:
        _migrate_usage_records(conn)
    with engine.begin() as conn:
        rows = {r.id: r for r in conn.execute(text("SELECT * FROM usage_records"))}
        notnull = {r[1]: r[3] for r in conn.execute(text("PRAGMA table_info(usage_records)"))}
        tables = [r[0] for r in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))]
    assert notnull["cost_usd"] == 0
    assert rows["a"].billing == "subscription"
    assert rows["a"].cost_usd is None and rows["a"].price_per_mtok is None
    assert rows["a"].tokens_total == 1000
    assert rows["b"].billing is None and rows["b"].cost_usd == 0.045
    assert "usage_records_pre416" not in tables


def test_migration_is_idempotent_and_skips_missing_table(tmp_path):
    engine = _engine(tmp_path)
    with engine.begin() as conn:
        _migrate_usage_records(conn)  # no table yet: nothing to do
        conn.execute(text(_LEGACY_DDL))
    for _ in range(2):
        with engine.begin() as conn:
            _migrate_usage_records(conn)
    with engine.begin() as conn:
        columns = [r[1] for r in conn.execute(text("PRAGMA table_info(usage_records)"))]
    assert columns.count("billing") == 1
