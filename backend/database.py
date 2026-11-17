import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./data/harness.db")

# Upgrade a plain `sqlite://` URL to the async driver. This has to be anchored
# at the start of the string: a naive `.replace("sqlite:///", ...)` also matches
# the tail of an already-correct `sqlite+aiosqlite:///` URL and rewrites it to
# `sqlite+aiosqlite+aiosqlite:///`, which SQLAlchemy rejects at import time —
# the backend could not start at all with the default configuration.
if DATABASE_URL.startswith("sqlite://"):
    DATABASE_URL = "sqlite+aiosqlite://" + DATABASE_URL[len("sqlite://"):]

engine = create_async_engine(DATABASE_URL, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with SessionLocal() as session:
        yield session


# Adapters that only ever ride a vendor's own CLI seat (Claude, Codex/ChatGPT,
# Cursor): a legacy ledger row from one of them was a subscription turn.
_SUBSCRIPTION_ADAPTERS = ("claude", "codex", "cursor")


def _migrate_usage_records(conn) -> None:
    """Bring a pre-#416 ``usage_records`` table to the current shape.

    ``create_all`` never alters an existing table, and SQLite cannot drop a
    NOT NULL constraint in place, so the table is rebuilt once: ``billing`` is
    added and ``cost_usd`` becomes nullable. Legacy rows from the subscription
    CLI adapters were priced as if they were API calls (F5): they are marked
    ``billing='subscription'`` with unknown cost, which corrects a wrong
    classification rather than repricing anything. Idempotent: a table that
    already has ``billing`` is left alone."""
    if conn.dialect.name != "sqlite":
        return
    from sqlalchemy import MetaData, Table, inspect, insert, select, text, update

    if "usage_records" not in inspect(conn).get_table_names():
        return
    current = Table("usage_records", MetaData(), autoload_with=conn)
    if "billing" in current.c:
        return
    from models import UsageRecord

    conn.execute(text("ALTER TABLE usage_records RENAME TO usage_records_pre416"))
    legacy = Table("usage_records_pre416", MetaData(), autoload_with=conn)
    table = UsageRecord.__table__
    table.create(conn)
    shared = [name for name in legacy.c.keys() if name in table.c]
    conn.execute(insert(table).from_select(shared, select(*(legacy.c[name] for name in shared))))
    conn.execute(
        update(table)
        .where(table.c.adapter.in_(_SUBSCRIPTION_ADAPTERS))
        .values(billing="subscription", cost_usd=None, price_per_mtok=None)
    )
    legacy.drop(conn)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(_migrate_usage_records)
        await conn.run_sync(Base.metadata.create_all)
