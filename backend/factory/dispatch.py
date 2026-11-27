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


class RunStopped(Exception):
    """A person stopped the run. The worktree stays; the stage does not complete."""


class StageRun:
    """What the driver sees of the run. Everything it does is journaled, redacted, and bounded."""

    def __init__(self, *, run_id: str, item_id: str, stage: str, agent_id: str, workspace: dict, definition: dict, store,
                 redactor: runner.RunRedactor, writer: RunWriter, limit: int, cancel: asyncio.Event | None = None,
                 steering: list[str] | None = None, on_child: Callable[[str, str], None] | None = None,
                 engine: str | None = None, runner_id: str | None = None, supervisor=None):
        self.run_id, self.item_id, self.stage, self.agent_id = run_id, item_id, stage, agent_id
        self.definition = definition
        self.engine, self.runner_id = engine, runner_id
        self.workspace = workspace
        self.tokens = 0
        self._definition, self._store, self._redactor, self._writer, self._limit = definition, store, redactor, writer, limit
        self._cancel = cancel or asyncio.Event()
        self._steering = steering if steering is not None else []
        self._on_child = on_child
        self.supervisor = supervisor

    def stopped(self) -> bool:
        return self._cancel.is_set()

    def pull_steering(self) -> list[str]:
        found = list(self._steering)
        self._steering.clear()
        return found

    async def open_child(self, label: str) -> str:
        """A nested run under this one. It shares the worktree; it does not move the item."""
        child_id = str(uuid.uuid4())
        text = str(label)[:80]
        if self._on_child is not None:
            self._on_child(child_id, text)
        await self._journal('child_run', {'run_id': child_id, 'label': text})
        return child_id

    async def _journal(self, event: str, data: dict) -> None:
        await self._writer.append({'event': event, 'data': _scrub(data, self._redactor)})

    async def tool(self, argv: list[str], timeout_s: float = TOOL_TIMEOUT_S) -> dict:
        argv = list(argv)
        if self.stopped():
            raise RunStopped('The run was stopped.')
        await self._journal('tool_call', {'name': 'command', 'argv': list(argv)})
        try:
            from factory import network_supervision
            decision = network_supervision.classify(self._definition, self.agent_id, list(argv))
            denied = runner.deny_command(argv, runner._protected(self._definition)) or decision.blocked
            approved = False
            if not denied and decision.required:
                approved = self.supervisor is not None and await self.supervisor.authorize(list(argv))
                if not approved:
                    denied = 'This command needs human network approval; it did not run.'
            if self.stopped():
                raise RunStopped('The run was stopped.')
            if denied:
                result = {'ok': False, 'result': denied, 'exit_code': None, 'timed_out': False, 'truncated': False,
                          'redactions': 0, 'duration_ms': 0}
            else:
                result = await runner.run_as_agent(self._definition, self.agent_id, list(argv), self.workspace, self._store, timeout_s,
                                                   network_approved=approved)
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
                    pool: runner.RunnerPool, repo, *, run_id: str | None = None, cancel: asyncio.Event | None = None,
                    steering: list[str] | None = None, on_child: Callable[[str, str], None] | None = None,
                    outcome: dict | None = None, engine: str | None = None, runner_id: str | None = None) -> str:
    """Runs `stage` for `item` and returns the run id. Raises DispatchError (nothing created) when it cannot start.

    `cancel` and `steering` are how a person stops the run and talks to it while it is going. A stop keeps the worktree.
    """
    agent_id, agent = _check(item, definition, stage, assignment)
    try:
        _, redactor = runner.secrets_for(definition, agent_id, store)
    except runner.RunnerError as exc:
        raise DispatchError(str(exc)) from exc
    limit = _limit(definition, assignment)
    if limit <= 0:
        raise DispatchError('the run has no token ceiling')
    async with pool.slot():
        run_id = run_id or str(uuid.uuid4())
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
                           store=store, redactor=redactor, writer=writer, limit=limit, cancel=cancel, steering=steering, on_child=on_child,
                           engine=engine, runner_id=runner_id)
            from factory import network_approvals
            run.supervisor = await network_approvals.make_supervisor(
                db, item, run_id, definition, agent_id, run._cancel, lambda value: _scrub(value, redactor), run._journal)
            await writer.append({'event': 'network_isolation', 'data': {'isolation': 'none', 'mode': 'supervised'}})
            await driver(run)
            await db.refresh(item)
            if run.stopped():
                raise RunStopped('The run was stopped.')
            if item.status != 'running':
                raise RunStopped('The item changed while the run was active.')
            sha = await asyncio.to_thread(_git, workspace, ['rev-parse', 'HEAD'])
            branch = f'forja/{item.id}-{run_id}'
            await foreman.implement_done(db, item, definition, branch, sha, base)
            item.cost_tokens = (item.cost_tokens or 0) + run.tokens
            await db.commit()
            await writer.append({'event': 'harness_done', 'data': {'status': 'complete', 'total_tokens': run.tokens, 'tokens_estimated': False}})
            if outcome is not None:
                outcome['status'] = 'complete'
        except (RunStopped, asyncio.CancelledError) as stopped:
            await db.rollback()
            await db.refresh(item)
            from factory.network_approvals import expire
            await expire(db, item, run_id)
            if item.status == 'running':
                item.status = 'queued'
            await service.add_event(db, item, 'run_stopped', foreman.FOREMAN, {'run_id': run_id})
            await db.commit()
            await writer.append({'event': 'harness_done', 'data': {'status': 'stopped', 'total_tokens': run.tokens if run else 0,
                                                                    'tokens_estimated': False}})
            if outcome is not None:
                outcome['status'] = 'stopped'
            if isinstance(stopped, asyncio.CancelledError):
                raise
        except Exception as exc:  # the run ends here, never the process: a person decides what happens next
            await db.rollback()
            await db.refresh(item)
            from factory.network_approvals import expire
            await expire(db, item, run_id)
            message = redactor.redact(f'{type(exc).__name__}: {exc}')
            tokens = run.tokens if run else 0
            item.cost_tokens = (item.cost_tokens or 0) + tokens
            await service.request_checkpoint(db, item, foreman.FOREMAN, 'question', f'The {stage} run stopped: {message}'[:500])
            await db.commit()
            await writer.append({'event': 'harness_done', 'data': {'status': 'error', 'total_tokens': tokens, 'tokens_estimated': False,
                                                                    'error': message}})
            if outcome is not None:
                outcome['status'] = 'error'
        finally:
            if run is not None and run.supervisor is not None:
                run.supervisor.close()
        return run_id
