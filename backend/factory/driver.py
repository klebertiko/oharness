"""The driver the app uses when a person starts a stage.

It records a note, accepts steering, and stops when asked. A model call is a later slice: this driver is what makes the
worktree, the pool and the live controls run in production, with no network and no provider.
"""
from __future__ import annotations

import asyncio

from factory.dispatch import RunStopped, StageRun


async def production_driver(run: StageRun) -> None:
    from factory import agent_mcp, runner

    config = runner.runner_config(run.definition, run.runner_id)
    for step in config.get('setup') or []:
        command = step.get('argv') if isinstance(step, dict) else step
        if run.stopped():
            raise RunStopped('The run was stopped.')
        result = await run.tool([str(part) for part in command])
        if not result.get('ok'):
            name = str(command[0]) if command else 'setup'
            detail = str(result.get('result') or '')[:200]
            raise runner.RunnerError(f'setup failed: {name}: {detail}')
    if run.engine:
        await run.note(f'engine {run.engine}')
    names = await agent_mcp.tools_for(run.definition, run.agent_id)
    if names:
        await run.note('tools ' + ','.join(names))
    await run.note('The stage ran in its worktree.')
    for _ in range(5):
        if run.stopped():
            raise RunStopped('The run was stopped.')
        for text in run.pull_steering():
            await run.note(text)
        await asyncio.sleep(0)
    if run.stopped():
        raise RunStopped('The run was stopped.')
    run.spend(1)
