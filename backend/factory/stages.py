"""Stages, statuses and the one table that maps them to a kanban column (ADR 0053, 0055). The UI mirrors it in `frontend/src/factory/types.ts`."""
from __future__ import annotations

STAGES = ('intake', 'triage', 'spec', 'implement', 'review', 'verify', 'handoff', 'monitor')
STATUSES = ('queued', 'running', 'awaiting_human', 'waiting_merge', 'claimed', 'parked', 'done', 'cancelled', 'failed')
COLUMNS = ('new', 'triaged', 'planned', 'implementing', 'in_review', 'verifying', 'handoff', 'monitoring',
           'claimed', 'needs_you', 'parked', 'done', 'closed')
CLOSED_STATUSES = ('done', 'cancelled', 'failed')


def column_of(stage: str, status: str) -> str:
    """Derived, never stored. Every (stage, status) pair has a column."""
    if status == 'done':
        return 'done'
    if status in ('cancelled', 'failed'):
        return 'closed'
    if status in ('parked', 'claimed'):
        return status
    if status == 'awaiting_human':
        return 'needs_you'
    if status == 'waiting_merge':
        return 'handoff'
    if stage in ('intake', 'triage'):
        return 'new'
    if stage == 'implement':
        return 'planned' if status == 'queued' else 'implementing'
    return {'spec': 'triaged', 'review': 'in_review', 'verify': 'verifying', 'handoff': 'handoff', 'monitor': 'monitoring'}[stage]


def pairs_for_column(column: str) -> list[tuple[str, str]]:
    return [(stage, status) for stage in STAGES for status in STATUSES if column_of(stage, status) == column]


def may_enter(current: str, target: str) -> bool:
    """Forward moves (a skipped stage is allowed) and the few ways back."""
    # Back moves: work returns to implement from review, verify or handoff; a passed verify goes on to review.
    if current in ('review', 'verify', 'handoff') and target == 'implement':
        return True
    if current == 'verify' and target == 'review':
        return True
    return STAGES.index(target) > STAGES.index(current)
