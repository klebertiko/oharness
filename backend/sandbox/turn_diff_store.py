"""Turn-diff persistence and the per-run tracker used by the direct run."""
import asyncio
import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import TurnChange
from .turn_diff import TURN_DIFF_RULES, RevertRefused, compute_changes, revert_file, snapshot

log = logging.getLogger(__name__)


class TurnTracker:
    """Snapshot the workspace when a turn starts; on `finish` persist what changed and describe it."""

    def __init__(self, root, run_id):
        self.root, self.run_id, self.before = str(Path(root).resolve()), run_id, None

    async def begin(self):
        try:
            self.before = await asyncio.to_thread(snapshot, self.root)
        except Exception:  # noqa: BLE001 -- a diff failure must never fail the run
            log.warning('turn diff: could not snapshot the workspace before the turn', exc_info=True)

    async def finish(self, session_factory):
        """The `turn_diff` event payload, or None when nothing changed and the snapshots were complete."""
        if self.before is None:
            return None
        try:
            after = await asyncio.to_thread(snapshot, self.root)
            changes = compute_changes(self.before, after)
            complete = self.before.complete and after.complete
            if not changes and complete:
                return None
            async with session_factory() as db:
                for c in changes:
                    db.add(TurnChange(run_id=self.run_id, path=c.path, root_path=self.root, status=c.status,
                                      before=c.before, after_sha=c.after_sha))
                await db.commit()
        except Exception:  # noqa: BLE001
            log.warning('turn diff: could not compute the diff', exc_info=True)
            return None
        limit = TURN_DIFF_RULES['max_listed_files']
        files = [{'path': c.path, 'status': c.status, 'added': c.added, 'removed': c.removed, 'binary': c.binary,
                  'revertible': c.revertible, 'diff': c.diff, 'diff_truncated': c.diff_truncated} for c in changes[:limit]]
        return {'files': files, 'omitted': max(0, len(changes) - limit), 'complete': complete}


async def revert_change(db: AsyncSession, run_id: str, path) -> str:
    """Revert one recorded file. Returns 'reverted'; raises KeyError (unknown) or RevertRefused."""
    if not isinstance(path, str):
        raise KeyError(path)
    row = await db.get(TurnChange, (run_id, path))
    if row is None:
        raise KeyError(path)
    if row.reverted:
        raise RevertRefused('already_reverted')
    await asyncio.to_thread(revert_file, row.root_path, row.path, row.status, row.before, row.after_sha)
    row.reverted = True
    await db.commit()
    return 'reverted'


async def recorded_paths(db: AsyncSession, run_id: str) -> list:
    return list((await db.scalars(select(TurnChange.path).where(TurnChange.run_id == run_id))).all())
