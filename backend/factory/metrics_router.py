"""`GET /factory/metrics` (ADR 0058): the same figures the control room shows, as JSON with a schema version."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from factory import metrics
from factory.service import FactoryError

router = APIRouter(prefix='/factory', tags=['factory'])


@router.get('/metrics')
async def get_metrics(window: str | None = None, since: str | None = None, until: str | None = None, factory_id: str | None = None,
                      factory_version: str | None = Query(default=None, max_length=metrics.FACTORY_VERSION_MAX), db: AsyncSession = Depends(get_db)):
    try:
        return await metrics.compute(db, window=window or ('7d' if not (since or until) else None), since=since, until=until, factory_id=factory_id,
                                     factory_version=factory_version)
    except FactoryError as exc:
        raise HTTPException(status_code=exc.status, detail={'code': exc.code, 'message': exc.detail}) from None
