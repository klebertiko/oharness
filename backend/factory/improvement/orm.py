"""Tables for scores, the failure book, proposals and the append-only decision trail.

A score or a failure is inserted and never rewritten. The proposal row is the current
state a screen reads; every decision is also an event, so the trail can be exported
without trusting the status column.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class AppendOnlyError(RuntimeError):
    """A score, a failure or a trail event was about to be changed or deleted."""


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class FactoryScore(Base):
    __tablename__ = 'factory_scores'
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    factory_id: Mapped[str] = mapped_column(String(64), nullable=False)
    version_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    scorer_id: Mapped[str] = mapped_column(String(64), nullable=False)
    run_id: Mapped[str] = mapped_column(String(200), nullable=False)
    work_item_id: Mapped[str | None] = mapped_column(String, nullable=True)
    agent_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    stage: Mapped[str | None] = mapped_column(String(16), nullable=True)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    cost_tokens: Mapped[int] = mapped_column(Integer, default=0)
    interventions: Mapped[int] = mapped_column(Integer, default=0)
    reason: Mapped[str] = mapped_column(Text, default='')
    at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    __table_args__ = (Index('ix_factory_scores_version', 'factory_id', 'version_hash'),)


class FactoryFailure(Base):
    """One row per recorded failure. Nothing here is updated; a later review is an event."""
    __tablename__ = 'factory_failures'
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    factory_id: Mapped[str] = mapped_column(String(64), nullable=False)
    agent_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    stage: Mapped[str | None] = mapped_column(String(16), nullable=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    scorer_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    run_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    work_item_id: Mapped[str | None] = mapped_column(String, nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    passing_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    reason: Mapped[str] = mapped_column(Text, default='')
    evidence_json: Mapped[str] = mapped_column(Text, default='{}')
    at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    __table_args__ = (Index('ix_factory_failures_factory', 'factory_id', 'at'),)


class ImprovementProposal(Base):
    __tablename__ = 'factory_improvements'
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    factory_id: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    analyst: Mapped[str | None] = mapped_column(String(64), nullable=True)
    before_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    after_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    before_json: Mapped[str] = mapped_column(Text, nullable=False)
    after_json: Mapped[str] = mapped_column(Text, nullable=False)
    diff_json: Mapped[str] = mapped_column(Text, nullable=False)
    justification: Mapped[str] = mapped_column(Text, default='')
    estimated_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    failure_ids_json: Mapped[str] = mapped_column(Text, default='[]')
    notes_json: Mapped[str] = mapped_column(Text, default='[]')
    rejection_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    verdict: Mapped[str | None] = mapped_column(String(16), nullable=True)
    canary_percent: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String(200), nullable=True)

    __table_args__ = (Index('ix_factory_improvements_factory', 'factory_id', 'status'),)


class ImprovementEvent(Base):
    """Append-only. Callers insert a row; nothing in this package updates or deletes one."""
    __tablename__ = 'factory_improvement_events'
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    proposal_id: Mapped[str] = mapped_column(String, nullable=False)
    factory_id: Mapped[str] = mapped_column(String(64), nullable=False)
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    actor_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    data_json: Mapped[str] = mapped_column(Text, default='{}')
    at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    __table_args__ = (Index('ix_factory_improvement_events_proposal', 'proposal_id', 'id'),)
