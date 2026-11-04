"""GET/PUT /flow/config -- the global default of the Flow switch (ADR 0065). Inherits sidecar authentication."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, StrictBool
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from flow import config

router = APIRouter(prefix="/flow", tags=["flow"])


class FlowConfigBody(BaseModel):
    enabled: StrictBool


@router.get("/config")
async def get_flow_config(db: AsyncSession = Depends(get_db)):
    return {"enabled": await config.get_enabled(db)}


@router.put("/config")
async def put_flow_config(body: FlowConfigBody, db: AsyncSession = Depends(get_db)):
    return {"enabled": await config.set_enabled(db, body.enabled)}
