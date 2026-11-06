"""Entries a person marked as done by hand (ADR 0058). The inbox itself is derived; only this choice is stored, and it can be undone."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class InboxDismissal(Base):
    __tablename__ = 'factory_inbox_dismissals'
    key: Mapped[str] = mapped_column(String(300), primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=_now)
