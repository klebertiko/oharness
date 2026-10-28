"""A run's own Git worktree (issue #159): the Workspace Manager's worktree is created when the run starts and removed when it ends.

Two runs on one repository then write to different directories and never to the main checkout. The worktree is a detached
checkout of the repository's HEAD under the managed root; work a run leaves in it is preserved by the manager's rescue ref
(ADR 0008) before the worktree is removed.
"""
from __future__ import annotations

import logging

import anyio
from fastapi import HTTPException

from workspaces.errors import WorkspaceError
from workspaces.service import WorkspaceService

log = logging.getLogger(__name__)


def require_workspace(requested: bool, cwd: str | None) -> None:
    """A run cannot be isolated without a validated project folder to branch from: refuse up front, before anything starts."""
    if requested and cwd is None:
        raise HTTPException(400, {"code": "worktree_needs_workspace",
                                  "message": "a worktree is made from a project folder; choose a workspace for this run"})


class RunWorktree:
    """``open()`` makes the worktree and returns its directory; ``close()`` removes it (never raises: a leftover is an `orphaned` workspace)."""

    def __init__(self, repo: str, service: WorkspaceService | None = None):
        self.repo = repo
        self.service = service or WorkspaceService()
        self.workspace_id: str | None = None
        self.path: str | None = None

    async def open(self) -> str:
        try:
            info = await anyio.to_thread.run_sync(self.service.create, self.repo, "HEAD")
        except WorkspaceError as exc:
            raise RuntimeError(f"could not make a worktree for this run: {exc.message}") from exc
        self.workspace_id, self.path = info["id"], info["path"]
        return self.path

    async def close(self) -> None:
        if self.workspace_id is None:
            return
        workspace_id, self.workspace_id = self.workspace_id, None
        with anyio.CancelScope(shield=True):  # the run may be ending because its client went away
            try:
                report = await anyio.to_thread.run_sync(self.service.removal_check, self.repo, workspace_id)
                await anyio.to_thread.run_sync(self.service.remove, self.repo, workspace_id, report["confirmation_token"])
            except Exception as exc:  # noqa: BLE001 - the run's outcome must not depend on the cleanup
                log.warning("run worktree %s was not removed: %s", workspace_id, exc)
