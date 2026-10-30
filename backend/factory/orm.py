"""Tables of the factory (ADR 0053). Same database as the rest of the sidecar; every table is prefixed `factory_`."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class WorkItem(Base):
    __tablename__ = 'factory_work_items'
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    factory_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # The definition version the item was born under; filled in once definitions exist (ADR 0056).
    factory_version: Mapped[str | None] = mapped_column(String(80), nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    source_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    source_subtype: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_ref: Mapped[str] = mapped_column(String(512), nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    thread_ref: Mapped[str | None] = mapped_column(String(512), nullable=True)
    origin_text: Mapped[str] = mapped_column(Text, default='')  # immutable, redacted, untrusted
    origin_truncated: Mapped[bool] = mapped_column(Boolean, default=False)
    origin_attachments_json: Mapped[str] = mapped_column(Text, default='[]')
    labels_json: Mapped[str] = mapped_column(Text, default='[]')
    requested_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    reopens: Mapped[str | None] = mapped_column(String, nullable=True)
    # Routing the owner configured (package B automation): kept apart from `origin_text`. `instructions` is the owner's trusted text
    # from the definition and is never mixed into the untrusted origin context (ADR 0059).
    agent: Mapped[str | None] = mapped_column(String(64), nullable=True)
    automation: Mapped[str | None] = mapped_column(String(64), nullable=True)
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_ceiling: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stage: Mapped[str] = mapped_column(String(16), nullable=False, default='intake')
    status: Mapped[str] = mapped_column(String(16), nullable=False, default='queued')
    spec_text: Mapped[str] = mapped_column(Text, default='')
    spec_revision: Mapped[int] = mapped_column(Integer, default=0)
    approved_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    claim_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    parked_from: Mapped[str | None] = mapped_column(String(16), nullable=True)
    cost_tokens: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint('factory_id', 'source_kind', 'idempotency_key', name='uq_factory_item_idempotency'),
        # One open item per source reference; a closed one lets the same reference start a new item.
        Index('uq_factory_item_open_source', 'factory_id', 'source_kind', 'source_ref', unique=True,
              sqlite_where=text("status NOT IN ('done', 'cancelled', 'failed')"),
              postgresql_where=text("status NOT IN ('done', 'cancelled', 'failed')")),
        Index('ix_factory_item_status', 'factory_id', 'status'),
    )


class WorkItemEvent(Base):
    """Append-only history; `data_json` is redacted before it is written."""
    __tablename__ = 'factory_work_item_events'
    work_item_id: Mapped[str] = mapped_column(ForeignKey('factory_work_items.id'), primary_key=True)
    sequence: Mapped[int] = mapped_column(Integer, primary_key=True)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    actor_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    data_json: Mapped[str] = mapped_column(Text, default='{}')
    at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class WorkItemRun(Base):
    """Links a run in the existing journal to a work item; events are referenced, never copied."""
    __tablename__ = 'factory_work_item_runs'
    work_item_id: Mapped[str] = mapped_column(ForeignKey('factory_work_items.id'), primary_key=True)
    run_id: Mapped[str] = mapped_column(String, primary_key=True)
    stage: Mapped[str] = mapped_column(String(16), nullable=False)
    agent_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    role: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class WorkItemArtifact(Base):
    """References only (a PR URL, a branch or range, a file under the factory data folder): never secrets or large blobs."""
    __tablename__ = 'factory_artifacts'
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    work_item_id: Mapped[str] = mapped_column(ForeignKey('factory_work_items.id'), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    ref: Mapped[str] = mapped_column(String(2048), nullable=False)
    label: Mapped[str] = mapped_column(String(200), default='')
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
