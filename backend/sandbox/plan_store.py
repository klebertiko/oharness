"""Plan artifacts of Plan mode: stored per conversation, approved or discarded only through the authenticated API."""
import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models import ChatPlan
from .permission_store import set_thread_mode

PLAN_MAX_CHARS = 200000  # far above any answer; text is stored whole, never cut, so what is approved is what was shown
# Where an approved plan may continue. Never `plan` (that is not leaving it) and never `full` (a deliberate, confirmed choice made in the composer).
APPROVAL_MODES = ('ask', 'auto_workspace', 'read_only', 'workspace_write')
DEFAULT_APPROVAL_MODE = 'ask'


class PlanError(Exception):
    def __init__(self, code: str, status: int):
        super().__init__(code)
        self.code, self.status = code, status


def as_dict(plan: ChatPlan) -> dict:
    return {'plan_id': plan.id, 'thread_id': plan.thread_id, 'text': plan.text, 'status': plan.status}


async def propose_plan(db: AsyncSession, thread_id: str, text: str) -> dict:
    """Store `text` as the conversation's waiting plan; any earlier waiting plan is superseded."""
    await db.execute(update(ChatPlan).where(ChatPlan.thread_id == thread_id, ChatPlan.status == 'proposed').values(status='discarded'))
    plan = ChatPlan(id=str(uuid.uuid4()), thread_id=thread_id, text=text[:PLAN_MAX_CHARS], status='proposed')
    db.add(plan)
    await db.commit()
    return as_dict(plan)


async def waiting_plan(db: AsyncSession, thread_id: str | None) -> dict | None:
    if not thread_id:
        return None
    row = (await db.execute(select(ChatPlan).where(ChatPlan.thread_id == thread_id, ChatPlan.status == 'proposed')
                            .order_by(ChatPlan.created_at.desc(), ChatPlan.id))).scalars().first()
    return as_dict(row) if row else None


async def _owned(db: AsyncSession, thread_id: str, plan_id: str) -> ChatPlan:
    plan = await db.get(ChatPlan, plan_id)
    if plan is None or plan.thread_id != thread_id:
        raise PlanError('plan_not_found', 404)
    if plan.status != 'proposed':
        raise PlanError('plan_not_proposed', 409)
    return plan


async def approve_plan(db: AsyncSession, thread_id: str, plan_id: str, mode: str) -> dict:
    """Mark the plan approved and move the conversation out of Plan mode to `mode`, as one step."""
    if mode not in APPROVAL_MODES:
        raise PlanError('invalid_argument', 400)
    plan = await _owned(db, thread_id, plan_id)
    plan.status = 'approved'
    await set_thread_mode(db, thread_id, mode)  # commits both
    return {'thread_id': thread_id, 'plan_id': plan_id, 'status': 'approved', 'mode': mode}


async def discard_plan(db: AsyncSession, thread_id: str, plan_id: str) -> dict:
    plan = await _owned(db, thread_id, plan_id)
    plan.status = 'discarded'
    await db.commit()
    return {'thread_id': thread_id, 'plan_id': plan_id, 'status': 'discarded'}
