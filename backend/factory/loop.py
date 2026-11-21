"""Starts a stage run in production: one worktree, a slot in the pool, and a handle a person can stop or steer.

The board lives in this process. A restart drops the live handles; the worktree and the journal stay.
"""
from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field

from database import SessionLocal
from factory import dispatch, runner, service
from factory.definition_rules import RUNNER_DEFAULTS
from factory.driver import production_driver


@dataclass
class LiveRun:
    run_id: str
    item_id: str
    title: str
    stage: str
    agent_id: str
    status: str
    engine: str | None
    harness: str | None
    cancel: asyncio.Event
    steering: list[str]
    children: list[dict] = field(default_factory=list)
    workspace: str | None = None


class LiveBoard:
    """The runs this process has started. `stop` and `steer` only see a run that is still going."""

    def __init__(self):
        self.runs: dict[str, LiveRun] = {}
        self.pools: dict[tuple, runner.RunnerPool] = {}

    def reset(self) -> None:
        self.runs.clear()
        self.pools.clear()

    def pool_for(self, definition: dict) -> runner.RunnerPool:
        limit = int(runner.runner_config(definition)['maxConcurrentRuns'])
        key = (str(definition.get('name') or ''), limit)
        if key not in self.pools:
            self.pools[key] = runner.RunnerPool(limit)
        return self.pools[key]

    def open(self, row: LiveRun) -> LiveRun:
        self.runs[row.run_id] = row
        return row

    def running_for(self, definition: dict) -> int:
        return self.pool_for(definition).running

    def get(self, run_id: str) -> LiveRun | None:
        return self.runs.get(run_id)

    def active_for_item(self, item_id: str) -> LiveRun | None:
        return next((row for row in self.runs.values() if row.item_id == item_id and row.status in ('starting', 'running')), None)

    def steer(self, run_id: str, text: str) -> None:
        row = self._live(run_id)
        row.steering.append(text)

    def stop(self, run_id: str) -> None:
        self._live(run_id).cancel.set()

    def _live(self, run_id: str) -> LiveRun:
        row = self.runs.get(run_id)
        if row is None or row.status not in ('starting', 'running'):
            raise KeyError(run_id)
        return row

    def occupancy(self) -> dict:
        if not self.pools:
            return {'limit': int(RUNNER_DEFAULTS['maxConcurrentRuns']), 'running': 0, 'waiting': 0}
        pool = next(reversed(self.pools.values()))
        return {'limit': pool.limit, 'running': pool.running, 'waiting': pool.waiting}

    def snapshot(self) -> dict:
        rows = []
        for row in reversed(self.runs.values()):
            rows.append({
                'run_id': row.run_id, 'item_id': row.item_id, 'title': row.title, 'stage': row.stage,
                'agent_id': row.agent_id, 'status': row.status, 'engine': row.engine, 'harness': row.harness,
                'children': list(row.children),
            })
        return {**self.occupancy(), 'runs': rows}


BOARD = LiveBoard()


def agent_for(definition: dict, stage: str, preferred: str | None) -> str:
    agents = definition.get('agents') or {}
    if isinstance(preferred, str) and preferred in agents:
        agent = agents[preferred]
        if agent.get('enabled', True) and agent.get('role') == stage:
            return preferred
    for name, agent in agents.items():
        if agent.get('enabled', True) and agent.get('role') == stage:
            return name
    raise dispatch.DispatchError(f'no agent has the {stage} role')


async def start(item_id: str, definition: dict, repo, store, driver=None) -> str:
    """Runs the item's current stage to completion (or until it is stopped) and returns the run id."""
    driver = driver or production_driver
    async with SessionLocal() as db:
        item = await service.get(db, item_id)
        stage = item.stage
        agent_id = agent_for(definition, stage, item.agent)
        agent = definition['agents'][agent_id]
        ceiling = int((definition.get('ceilings') or {}).get('tokensPerRun') or 0)
        assignment = {'agent': agent_id, 'model': agent.get('model'), 'harness': agent.get('harness'), 'maxTokens': ceiling}
        run_id = str(uuid.uuid4())
        row = BOARD.open(LiveRun(
            run_id=run_id, item_id=item.id, title=item.title, stage=stage, agent_id=agent_id, status='starting',
            engine=agent.get('engine'), harness=agent.get('harness'), cancel=asyncio.Event(), steering=[],
        ))
        pool = BOARD.pool_for(definition)
        outcome: dict = {'status': 'error'}

        def on_child(child_id: str, label: str) -> None:
            row.children.append({'run_id': child_id, 'label': label, 'status': 'running'})

        async def wrapped(run: dispatch.StageRun) -> None:
            row.status = 'running'
            row.workspace = str((run.workspace or {}).get('path') or '') or None
            await driver(run)

        try:
            await dispatch.run_stage(db, item, definition, stage, assignment, wrapped, store, pool, repo,
                                     run_id=run_id, cancel=row.cancel, steering=row.steering, on_child=on_child, outcome=outcome)
        except dispatch.DispatchError:
            row.status = 'error'
            raise
        row.status = outcome['status']
        return run_id


def steer(run_id: str, text: str) -> None:
    BOARD.steer(run_id, text)


def stop(run_id: str) -> None:
    BOARD.stop(run_id)


def snapshot() -> dict:
    return BOARD.snapshot()
