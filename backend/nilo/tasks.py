"""Work that keeps going after the chat turn.

The person sees a status card, not a narrated handoff. Milestones are rare and
only when the stage changes. The final note is one factual message. A forja
task may submit and read status. It never approves a spec and never merges.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from nilo.orm import NiloPreference, NiloTask
from nilo.voice import lint_voice
from run_store import redact_value

KINDS = ("harness", "subagents", "forja")
MILESTONE_GAP = timedelta(seconds=30)
NOTIFY_KINDS = frozenset({"done", "failed", "needs_you"})
_booted = False


class TaskError(Exception):
    def __init__(self, code: str, status: int) -> None:
        self.code = code
        self.status = status


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _events(task: NiloTask) -> list[dict]:
    try:
        loaded = json.loads(task.events_json or "[]")
    except json.JSONDecodeError:
        return []
    return loaded if isinstance(loaded, list) else []


def _artifacts(task: NiloTask) -> list[dict]:
    try:
        loaded = json.loads(task.artifacts_json or "[]")
    except json.JSONDecodeError:
        return []
    return loaded if isinstance(loaded, list) else []


def forja_argv(instruction: str) -> list[str]:
    """The only forja invocation a task may build: submit, then read. Never approve, never merge."""
    title = redact_value(instruction).strip()[:200]
    return ["oharness", "forja", "submit", "--title", title]


def accept_milestone(previous_stage: str, previous_at: datetime | None, stage: str, now: datetime) -> bool:
    """At most one milestone per 30 seconds, and only when the stage actually changes."""
    if not stage or stage == previous_stage:
        return False
    if previous_at is not None and now - previous_at < MILESTONE_GAP:
        return False
    return True


def should_notify(*, enabled: bool, focused: bool, kind: str) -> bool:
    """System notification only when it is on, the window is in the background, and the news is final."""
    if not enabled or focused:
        return False
    return kind in NOTIFY_KINDS


def compose_delivery(summary: str, artifacts: list[dict]) -> str:
    """One factual closing note. A loud or emcee line is replaced, not shipped."""
    links = ", ".join(str(item.get("ref") or "") for item in artifacts if item.get("ref"))
    text = redact_value(summary).replace("!", "").strip()
    if links:
        text = f"{text} {links}".strip()
    if not text or lint_voice(text):
        text = "Terminou. Revise o resultado e decida o próximo passo."
    return text


def _public(task: NiloTask) -> dict:
    return {
        "id": task.id,
        "thread_id": task.thread_id,
        "title": task.title,
        "instruction": task.instruction,
        "kind": task.kind,
        "state": task.state,
        "stage": task.stage,
        "summary": task.summary,
        "reason": task.reason,
        "next_action": task.next_action,
        "artifacts": _artifacts(task),
        "created_at": task.created_at.isoformat() + "Z",
        "updated_at": task.updated_at.isoformat() + "Z",
    }


def simulate_restart() -> None:
    """The next task request behaves as a fresh sidecar and interrupts work that was running."""
    global _booted
    _booted = False


async def recover_if_needed(db: AsyncSession) -> None:
    global _booted
    if _booted:
        return
    _booted = True
    await db.execute(update(NiloTask).where(NiloTask.state == "running").values(state="interrupted", updated_at=_now()))
    await db.commit()


async def notifications_enabled(db: AsyncSession) -> bool:
    row = await db.get(NiloPreference, "notifications")
    return bool(row and row.value == "on")


async def set_notifications(db: AsyncSession, enabled: bool) -> bool:
    row = await db.get(NiloPreference, "notifications")
    value = "on" if enabled else "off"
    if row is None:
        db.add(NiloPreference(key="notifications", value=value))
    else:
        row.value = value
    await db.commit()
    return enabled


async def create(db: AsyncSession, *, thread_id: str, title: str, instruction: str, kind: str) -> dict:
    await recover_if_needed(db)
    if kind not in KINDS or not title.strip() or not instruction.strip():
        raise TaskError("nilo.tasks.error.invalid", 422)
    clean_title = redact_value(title.strip())[:200]
    clean_instruction = redact_value(instruction.strip())
    task = NiloTask(
        thread_id=thread_id[:80],
        title=clean_title,
        instruction=clean_instruction,
        kind=kind,
        state="running",
        events_json=json.dumps([{"event": "task_started", "id": "", "title": clean_title}]),
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    events = _events(task)
    events[0]["id"] = task.id
    if kind == "forja":
        events.append({"event": "task_milestone", "text": "submitted"})
        task.stage = "submitted"
        task.artifacts_json = json.dumps([{"kind": "forja", "ref": "forja:submitted"}])
    task.events_json = json.dumps(events)
    await db.commit()
    await db.refresh(task)
    return _public(task)


async def list_tasks(db: AsyncSession, *, state: str | None = None) -> list[dict]:
    await recover_if_needed(db)
    query = select(NiloTask).order_by(NiloTask.created_at.desc())
    if state:
        query = query.where(NiloTask.state == state)
    return [_public(item) for item in await db.scalars(query)]


async def get_task(db: AsyncSession, task_id: str) -> NiloTask:
    await recover_if_needed(db)
    task = await db.get(NiloTask, task_id)
    if task is None:
        raise TaskError("nilo.tasks.error.notFound", 404)
    return task


async def cancel(db: AsyncSession, task_id: str) -> dict:
    task = await get_task(db, task_id)
    if task.state == "running":
        task.state = "cancelled"
        await db.commit()
        await db.refresh(task)
    return _public(task)


async def continue_task(db: AsyncSession, task_id: str) -> dict:
    task = await get_task(db, task_id)
    if task.state != "interrupted":
        raise TaskError("nilo.tasks.error.notInterrupted", 409)
    task.state = "running"
    await db.commit()
    await db.refresh(task)
    return _public(task)


async def record_milestone(db: AsyncSession, task_id: str, stage: str, text: str, now: datetime | None = None) -> dict | None:
    task = await get_task(db, task_id)
    moment = now or _now()
    if not accept_milestone(task.stage, task.last_milestone_at, stage, moment):
        return None
    task.stage = stage
    task.last_milestone_at = moment
    events = _events(task)
    events.append({"event": "task_milestone", "text": redact_value(text)[:240]})
    task.events_json = json.dumps(events)
    await db.commit()
    return events[-1]


async def finish(db: AsyncSession, task_id: str, summary: str, artifacts: list[dict] | None = None) -> dict:
    task = await get_task(db, task_id)
    arts = [{"kind": str(item.get("kind") or "ref"), "ref": redact_value(str(item.get("ref") or ""))} for item in (artifacts or [])]
    note = compose_delivery(summary, arts)
    task.state = "done"
    task.summary = note
    task.artifacts_json = json.dumps(arts)
    events = _events(task)
    events.append({"event": "task_done", "summary": note, "artifacts": arts})
    task.events_json = json.dumps(events)
    await db.commit()
    await db.refresh(task)
    return _public(task)


async def fail(db: AsyncSession, task_id: str, reason: str, next_action: str) -> dict:
    task = await get_task(db, task_id)
    task.state = "failed"
    task.reason = redact_value(reason)[:400]
    task.next_action = redact_value(next_action)[:240]
    events = _events(task)
    events.append({"event": "task_failed", "reason": task.reason, "next_action": task.next_action})
    task.events_json = json.dumps(events)
    await db.commit()
    await db.refresh(task)
    return _public(task)
