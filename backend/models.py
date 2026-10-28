import uuid
from datetime import datetime
from sqlalchemy import LargeBinary, String, DateTime, Text, Boolean, Float, Integer, ForeignKey, ForeignKeyConstraint, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class Harness(Base):
    __tablename__ = "harnesses"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    graph_json: Mapped[str] = mapped_column(Text, nullable=False)  # nodes + edges as JSON
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class ExecutionLog(Base):
    __tablename__ = "execution_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    harness_id: Mapped[str] = mapped_column(String, nullable=False)
    harness_name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="running")  # running, complete, error
    result_json: Mapped[str] = mapped_column(Text, default="{}")
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    finished_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)


class RunRecord(Base):
    """Versioned capture metadata, absent for legacy ExecutionLogs."""
    __tablename__ = "run_records"
    id: Mapped[str] = mapped_column(ForeignKey("execution_logs.id"), primary_key=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    coverage: Mapped[str] = mapped_column(String(24), default="partial")
    last_sequence: Mapped[int] = mapped_column(Integer, default=0)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)


class RunEvent(Base):
    """Append-only, ordered within a run; schema_version describes the envelope."""
    __tablename__ = "run_events"
    run_id: Mapped[str] = mapped_column(ForeignKey("run_records.id"), primary_key=True)
    sequence: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    data_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class RunArtifact(Base):
    """Immutable output versions stored in the same transaction as their event."""
    __tablename__ = "run_artifacts"
    __table_args__ = (ForeignKeyConstraint(["run_id", "event_sequence"], ["run_events.run_id", "run_events.sequence"]),
                      UniqueConstraint("run_id", "event_sequence", "kind"),
                      UniqueConstraint("run_id", "name", "version"))
    id: Mapped[str] = mapped_column(String, primary_key=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("run_records.id"), index=True)
    event_sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    media_type: Mapped[str] = mapped_column(String(64), nullable=False)
    content_json: Mapped[str] = mapped_column(Text, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)


class ProviderConnection(Base):
    """Durable twin of the `app.state.provider_connections` runtime dict
    (`routers/providers.py`). That dict was in-memory only — every sidecar
    restart silently wiped every connection while the frontend kept showing
    stale "connected" status for them (surfaced live, 2026-09-12: a green
    dot on a provider the backend had already forgotten, "Connection was
    not found" on the next real send). This table is the source of truth;
    the in-memory dict is now just a hydration of it, kept for the read-path
    call sites that already expect a plain dict."""

    __tablename__ = "provider_connections"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    residence: Mapped[str] = mapped_column(String(16), nullable=False)
    endpoint: Mapped[str] = mapped_column(String(1024), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    secret_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    default_model: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class CoworkProject(Base):
    __tablename__ = "cowork_projects"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    root_path: Mapped[str] = mapped_column(String(1024), default="")
    instructions: Mapped[str] = mapped_column(Text, default="")
    memory_json: Mapped[str] = mapped_column(Text, default="{}")
    harness_bundle_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    harness_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class ChatPermission(Base):
    """Permission mode of one chat conversation (`plan` | `ask` | `auto_workspace`).

    Enforced by the sidecar (`sandbox.permission`); the UI only selects it. A
    missing row means `ask`. A run request can tighten but never loosen it."""
    __tablename__ = "chat_permissions"

    thread_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    mode: Mapped[str] = mapped_column(String(32), nullable=False, default="ask")
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class ChatPlan(Base):
    """The plan artifact a Plan-mode run ends in (`proposed` | `approved` | `discarded`).

    One conversation has at most one `proposed` plan; while it waits, the conversation cannot leave Plan mode
    (`sandbox.plan_store`). Only an authenticated client can approve or discard; a model's tool call cannot."""
    __tablename__ = "chat_plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    thread_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="proposed")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class WorkspaceTrust(Base):
    """Per-workspace trust (false unless a person said so through the UI).

    A trusted workspace lets `auto_workspace` run the project's own scripts
    (npm test, pytest...) without asking. Keyed by the resolved root of a
    registered Cowork project. Never settable from a run request."""
    __tablename__ = "workspace_trust"

    root_path: Mapped[str] = mapped_column(String(1024), primary_key=True)
    trusted: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class UsageRecord(Base):
    """One row per completed node/turn that actually reached a real vendor —
    the durable source of truth for tokens spent and USD cost, written once
    a run's outcome is already known (`routers/execution.py`'s
    `event_stream()` finally-block, alongside the existing `ExecutionLog`
    write; never speculatively, never from the frontend's own say-so).

    `cost_usd` and `price_per_mtok` are computed and frozen at write time
    from the catalog price *then in effect* (`adapters/catalog.py`'s
    `MODEL_PRICES`) — a later catalog price change must never retroactively
    rewrite what a past run actually cost. `price_per_mtok` is the *blended*
    rate — average of the catalog's [input, output] $/Mtok — because the
    adapter layer only ever reports one combined token count per turn today
    (see `adapters/base.py`'s `usage` SSE event shape); there is no real
    input/output split available to price exactly. `price_per_mtok is None`
    means this model's price is not in the catalog (mock mode, or a real
    model this catalog doesn't know the price of yet) — never conflate that
    with "genuinely free": a local/on-device model reads that way too, and
    the two are told apart by the caller via the connection's `residence`,
    not by anything stored on this row.

    A row is only ever written for real spend: `usage_tracking.record_usage`
    refuses `tokens_total <= 0` and the `mock`/`unresolved` adapters outright,
    so this table is real-usage-only by construction — never a place a
    synthetic/demo number could leak into the Providers screen's totals.
    """

    __tablename__ = "usage_records"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id: Mapped[str] = mapped_column(String, nullable=False)
    node_id: Mapped[str | None] = mapped_column(String, nullable=True)
    source: Mapped[str] = mapped_column(String(16), default="harness")  # harness | direct
    connection_id: Mapped[str | None] = mapped_column(String, nullable=True)
    provider: Mapped[str] = mapped_column(String(64), default="")
    adapter: Mapped[str] = mapped_column(String(64), default="")
    model: Mapped[str] = mapped_column(String(255), default="")
    tokens_total: Mapped[int] = mapped_column(Integer, default=0)
    price_per_mtok: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class BudgetConfig(Base):
    """Singleton row (id='global') — the one overall USD ceiling covering
    every real spend path this app has *today*: chat (the triage/intake
    call), harness runs, and direct turns, regardless of agent or provider
    (`usage_tracking.enforce_budget_or_raise` is the one gate every one of
    them calls before it starts). `limit_usd is None` means unset — no
    budget enforced, and the UI must say so plainly rather than defaulting
    to a fabricated number.
    """

    __tablename__ = "budget_config"

    id: Mapped[str] = mapped_column(String, primary_key=True, default="global")
    limit_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class ToolHook(Base):
    """A pre-tool hook (`sandbox.hooks`): a program that must exit 0 before a tool runs.

    Registered through the sidecar only; never read from a workspace or a run
    request. `argv_json` / `tools_json` are validated on write and again on
    load: a row that no longer validates blocks (fail-closed), it is not skipped."""
    __tablename__ = "tool_hooks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    argv_json: Mapped[str] = mapped_column(Text, nullable=False)
    tools_json: Mapped[str] = mapped_column(Text, nullable=False)
    timeout_s: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class TurnChange(Base):
    """One file a turn changed (#163), with its pre-turn bytes so one file can be reverted.

    Text files only keep `before`; secret-named files are never recorded. `reverted`
    makes a revert one-shot. Rows stay with the run."""
    __tablename__ = "turn_changes"

    run_id: Mapped[str] = mapped_column(String, primary_key=True)
    path: Mapped[str] = mapped_column(String(1024), primary_key=True)
    root_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    before: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    after_sha: Mapped[str | None] = mapped_column(String(80), nullable=True)
    mode: Mapped[int] = mapped_column(Integer, default=0o644)
    reverted: Mapped[bool] = mapped_column(Boolean, default=False)
