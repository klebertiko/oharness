"""`/nilo/tasks`. The chat stays free while a task runs. There is no approve route and no merge route."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from nilo import tasks
from nilo.tasks import TaskError

router = APIRouter(prefix="/nilo/tasks", tags=["nilo"])


class TaskBody(BaseModel):
    thread_id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=200)
    instruction: str = Field(min_length=1, max_length=8000)
    kind: str


class NotifyBody(BaseModel):
    enabled: bool


class FocusBody(BaseModel):
    focused: bool
    kind: str = "done"


def _http(exc: TaskError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail={"code": exc.code})


@router.get("")
async def list_tasks(state: str | None = None, db: AsyncSession = Depends(get_db)):
    return await tasks.list_tasks(db, state=state)


@router.post("", status_code=201)
async def start_task(body: TaskBody, db: AsyncSession = Depends(get_db)):
    try:
        item = await tasks.create(db, thread_id=body.thread_id, title=body.title, instruction=body.instruction, kind=body.kind)
    except TaskError as exc:
        raise _http(exc) from None
    return {"id": item["id"], "state": item["state"]}


@router.post("/{task_id}/cancel")
async def cancel_task(task_id: str, db: AsyncSession = Depends(get_db)):
    try:
        return await tasks.cancel(db, task_id)
    except TaskError as exc:
        raise _http(exc) from None


@router.post("/{task_id}/continue")
async def continue_task(task_id: str, db: AsyncSession = Depends(get_db)):
    try:
        return await tasks.continue_task(db, task_id)
    except TaskError as exc:
        raise _http(exc) from None


@router.get("/{task_id}/events")
async def task_events(task_id: str, db: AsyncSession = Depends(get_db)):
    try:
        task = await tasks.get_task(db, task_id)
    except TaskError as exc:
        raise _http(exc) from None
    payload = "\n\n".join(
        f"event: {item['event']}\ndata: {json.dumps({k: v for k, v in item.items() if k != 'event'})}"
        for item in json.loads(task.events_json or "[]")
    ) + "\n\n"

    async def chunks():
        yield payload

    return StreamingResponse(chunks(), media_type="text/event-stream")


@router.get("/notifications")
async def read_notifications(db: AsyncSession = Depends(get_db)):
    return {"enabled": await tasks.notifications_enabled(db)}


@router.put("/notifications")
async def write_notifications(body: NotifyBody, db: AsyncSession = Depends(get_db)):
    return {"enabled": await tasks.set_notifications(db, body.enabled)}


@router.post("/notifications/decide")
async def decide_notification(body: FocusBody, db: AsyncSession = Depends(get_db)):
    enabled = await tasks.notifications_enabled(db)
    return {"notify": tasks.should_notify(enabled=enabled, focused=body.focused, kind=body.kind)}
