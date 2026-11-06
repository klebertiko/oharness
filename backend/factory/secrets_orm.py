"""Which Forja secrets exist, and when they last changed (ADR 0057). The values live only in the secrets vault, under `forja/<name>`."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class SecretIndex(Base):
    __tablename__ = 'factory_secret_index'
    name: Mapped[str] = mapped_column(String(100), primary_key=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
