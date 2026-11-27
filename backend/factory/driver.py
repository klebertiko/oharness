"""The driver the app uses when a person starts a stage.

It records a note, accepts steering, and stops when asked. A model call is a later slice: this driver is what makes the
worktree, the pool and the live controls run in production, with no network and no provider.
"""
from __future__ import annotations

import asyncio

from factory.dispatch import RunStopped, StageRun


async def production_driver(run: StageRun) -> None:
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
