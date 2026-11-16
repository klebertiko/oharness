"""Dispatch of one stage run (ADR 0057, #440): the foreman hands a work item to an agent and the runner does the work.

One run = one worktree on its own branch, the agent's secrets by reference only (`forja/<name>`), every write redacted with the exact
values, a token ceiling per run and a slot in the runner pool. The agent itself is a `driver`: a coroutine that works through
`StageRun` (tool, note, spend) the way a model tool loop would; tests pass a fake, so there is no network and no provider here.
A failure never completes a stage: the item waits for a person and the message carries no secret value.
"""
from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from factory import foreman, runner, service
from factory.orm import WorkItem
from models import ExecutionLog, RunRecord
from run_store import RunWriter

DISPATCHABLE = ('implement',)  # review and verify come through the same door in a later slice
TOOL_TIMEOUT_S = 60


class DispatchError(ValueError):
    """The stage cannot be dispatched; nothing was created."""


class TokenCeiling(RuntimeError):
    """The run spent more than its ceiling."""


def pool_for(definition: dict) -> runner.RunnerPool:
    return runner.RunnerPool(int(runner.runner_config(definition)['maxConcurrentRuns']))


def _scrub(value, redactor: runner.RunRedactor):
    if isinstance(value, str):
        return redactor.redact(value)
    if isinstance(value, dict):
        return {redactor.redact(str(k)): _scrub(v, redactor) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_scrub(v, redactor) for v in value]
    return value


class StageRun:
    """What the driver sees of the run. Everything it does is journaled, redacted, and bounded."""

    def __init__(self, *, run_id: str, item_id: str, stage: str, agent_id: str, workspace: dict, definition: dict, store,
                 redactor: runner.RunRedactor, writer: RunWriter, limit: int):
        self.run_id, self.item_id, self.stage, self.agent_id = run_id, item_id, stage, agent_id
        self.workspace = workspace
        self.tokens = 0
        self._definition, self._store, self._redactor, self._writer, self._limit = definition, store, redactor, writer, limit

    async def _journal(self, event: str, data: dict) -> None:
        await self._writer.append({'event': event, 'data': _scrub(data, self._redactor)})

    async def tool(self, argv: list[str], timeout_s: float = TOOL_TIMEOUT_S) -> dict:
        await self._journal('tool_call', {'name': 'command', 'argv': list(argv)})
        try:
            result = await runner.run_as_agent(self._definition, self.agent_id, list(argv), self.workspace, self._store, timeout_s)
        except runner.RunnerError as exc:
            result = {'ok': False, 'result': str(exc), 'exit_code': None, 'timed_out': False, 'truncated': False, 'redactions': 0, 'duration_ms': 0}
        result = _scrub(result, self._redactor)
        await self._journal('tool_result', {'name': 'command', **result})
        return result

    async def note(self, text: str) -> None:
        await self._journal('agent_note', {'text': text})

    def spend(self, tokens: int) -> None:
        self.tokens += max(0, int(tokens))
        if self.tokens > self._limit:
            raise TokenCeiling(f'The run spent {self.tokens} tokens; its ceiling is {self._limit}.')


Driver = Callable[[StageRun], Awaitable[None]]


def _check(item: WorkItem, definition: dict, stage: str, assignment: dict) -> tuple[str, dict]:
    if stage not in DISPATCHABLE:
        raise DispatchError(f'stage {stage} is not dispatched yet')
    if item.stage != stage or item.status not in ('queued', 'running'):
        raise DispatchError(f'the work item is at {item.stage} ({item.status}), not ready for {stage}')
    agent_id = assignment.get('agent')
    agent = definition.get('agents', {}).get(agent_id) if isinstance(agent_id, str) else None
    if not agent or not agent.get('enabled', True):
        raise DispatchError('the assigned agent is missing or off')
    if agent.get('role') != stage:
        raise DispatchError(f'the assigned agent does not have the {stage} role')
    return agent_id, agent


def _limit(definition: dict, assignment: dict) -> int:
    ceiling = int(definition.get('ceilings', {}).get('tokensPerRun') or 0)
    asked = int(assignment.get('maxTokens') or 0)
    return min(v for v in (ceiling, asked) if v > 0) if (ceiling or asked) else 0


def _git(workspace: dict, args: list[str]) -> str:
    from workspaces.service import WorkspaceService

    return WorkspaceService().runner.run(Path(workspace['path']), args).text().strip()


async def run_stage(db: AsyncSession, item: WorkItem, definition: dict, stage: str, assignment: dict, driver: Driver, store,
                    pool: runner.RunnerPool, repo) -> str:
    """Runs `stage` for `item` and returns the run id. Raises DispatchError (nothing created) when it cannot start."""
    agent_id, agent = _check(item, definition, stage, assignment)
    try:
        _, redactor = runner.secrets_for(definition, agent_id, store)
    except runner.RunnerError as exc:
        raise DispatchError(str(exc)) from exc
    limit = _limit(definition, assignment)
    if limit <= 0:
        raise DispatchError('the run has no token ceiling')
    async with pool.slot():
        run_id = str(uuid.uuid4())
        db.add(ExecutionLog(id=run_id, harness_id='forja', harness_name=f'forja/{item.id}/{stage}', status='running'))
        db.add(RunRecord(id=run_id, source='forja'))
        await db.commit()
        writer = RunWriter(run_id)
        await service.link_run(db, item, run_id, stage, foreman.FOREMAN, agent_id, agent.get('role'))
        item.status = 'running'
        await db.commit()
        run = None
        try:
            workspace = await asyncio.to_thread(runner.create_run_workspace, repo, item.id, run_id)
            base = await asyncio.to_thread(_git, workspace, ['rev-parse', 'HEAD'])
            run = StageRun(run_id=run_id, item_id=item.id, stage=stage, agent_id=agent_id, workspace=workspace, definition=definition,
                           store=store, redactor=redactor, writer=writer, limit=limit)
            await driver(run)
            sha = await asyncio.to_thread(_git, workspace, ['rev-parse', 'HEAD'])
            branch = f'forja/{item.id}-{run_id}'
            await foreman.implement_done(db, item, definition, branch, sha, base)
            item.cost_tokens = (item.cost_tokens or 0) + run.tokens
            await db.commit()
            await writer.append({'event': 'harness_done', 'data': {'status': 'complete', 'total_tokens': run.tokens, 'tokens_estimated': False}})
        except Exception as exc:  # the run ends here, never the process: a person decides what happens next
            await db.rollback()
            await db.refresh(item)
            message = redactor.redact(f'{type(exc).__name__}: {exc}')
            tokens = run.tokens if run else 0
            item.cost_tokens = (item.cost_tokens or 0) + tokens
            await service.request_checkpoint(db, item, foreman.FOREMAN, 'question', f'The {stage} run stopped: {message}'[:500])
            await db.commit()
            await writer.append({'event': 'harness_done', 'data': {'status': 'error', 'total_tokens': tokens, 'tokens_estimated': False,
                                                                    'error': message}})
        return run_id
