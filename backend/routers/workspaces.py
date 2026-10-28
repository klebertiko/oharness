"""Workspace Manager API: Git worktrees as managed, selectable, safely removable workspaces (ADR 0008).

Authentication is not declared here: ``main.require_sidecar_token`` guards every route but ``/health``, exactly as for the other
routers, so these routes need ``Authorization: Bearer <sidecar token>``. Handlers are plain ``def`` (run in FastAPI's thread pool)
because every operation shells out to git.

The client names the *source repository* and a ref; it never names a destination path. Errors are
``{"detail": {"code": ..., "message": ...}}`` with a stable ``code``.
"""
from __future__ import annotations

import json
import math
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from workspaces.errors import WorkspaceError, scrub_paths
from workspaces.gitrun import GitFailure
from workspaces.service import WorkspaceService

def _no_non_finite(constant: str):
    raise ValueError(f"{constant} is not valid JSON")


def _finite_float(text: str) -> float:
    value = float(text)
    if not math.isfinite(value):  # 1e999 parses to inf, which pydantic would echo into an error body the encoder cannot serialise
        raise ValueError(f"{text} is not valid JSON")
    return value


MAX_NESTING = 100  # no request of this API nests more than three levels; FastAPI's error encoder gives out near 330 and the parser near 1000


def _has_lone_surrogate(value: Any) -> bool:
    """A string (or key) anywhere in the parsed body that holds a lone UTF-16 surrogate: it cannot be encoded as UTF-8 anywhere downstream.

    Walked with an explicit stack (a recursive walk over a body nested a thousand levels deep exhausts the interpreter's stack: a
    500). A body nested deeper than ``MAX_NESTING`` is refused as invalid JSON before pydantic can echo it into an error report.
    """
    pending = [(value, 0)]
    while pending:
        current, depth = pending.pop()
        if isinstance(current, str):
            try:
                current.encode("utf-8")
            except UnicodeEncodeError:
                return True
        elif isinstance(current, (dict, list)):
            if depth >= MAX_NESTING:
                raise ValueError("a body nested this deeply is not valid JSON")
            children = [*current.keys(), *current.values()] if isinstance(current, dict) else current
            pending.extend((child, depth + 1) for child in children)
    return False


async def strict_json(request: Request) -> None:
    """Refuse ``NaN``/``Infinity``, out-of-range numbers and lone surrogates in a body with a 422 before validation runs.

    Python's JSON parser accepts them, and pydantic then echoes the offending value into its error report, which the response
    encoder cannot serialise: a 500 for what is plainly a client mistake.
    """
    raw = await request.body()
    if not raw:
        return
    try:
        parsed = json.loads(raw, parse_constant=_no_non_finite, parse_float=_finite_float)
        if _has_lone_surrogate(parsed):  # "\ud800": valid JSON, but pydantic echoes it into an error body (or git gets it) and the encoder fails
            raise ValueError("a lone surrogate is not valid JSON")
    except ValueError as exc:
        if "is not valid JSON" in str(exc):
            raise HTTPException(status_code=422, detail={"code": "invalid_json", "message": "NaN, Infinity, numbers beyond the float range, lone surrogates and nesting beyond 100 levels are not valid"}) from exc
        # any other parse failure is reported by FastAPI's own body handling


router = APIRouter(prefix="/workspaces", tags=["workspaces"], dependencies=[Depends(strict_json)])


def get_service() -> WorkspaceService:
    """Built per request so the data directory is read from the environment each time; overridable in tests."""
    return WorkspaceService()


class CreateBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    repo: str = Field(min_length=1, max_length=1024, description="A directory inside the source repository (absolute path).")
    ref: str = Field(min_length=1, max_length=255, description="Branch, tag or commit to start from.")
    branch: str | None = Field(default=None, max_length=100, description="Optional new branch to create at the ref; omitted = detached HEAD.")


class SelectBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    repo: str = Field(min_length=1, max_length=1024)
    id: str = Field(min_length=1, max_length=64)


class CheckBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    repo: str = Field(min_length=1, max_length=1024)


class RemoveBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    repo: str = Field(min_length=1, max_length=1024)
    confirmation_token: str = Field(max_length=256, description="From removal-check; bound to the workspace state at that moment.")
    release_lock: bool = Field(default=False, description="Explicitly release a git lock on the worktree before removing it.")


def _run(fn, *args, **kwargs) -> Any:
    try:
        return fn(*args, **kwargs)
    except WorkspaceError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.to_dict()) from exc
    except GitFailure as exc:
        raise HTTPException(status_code=502, detail={"code": "git_failed", "message": "git failed", "detail": scrub_paths(exc.stderr.strip())[:300]}) from exc


@router.get("")
def list_workspaces(repo: str, service: WorkspaceService = Depends(get_service)):
    """Every worktree of the repository: id, path, branch/detached, HEAD, change counts, lock, missing/prunable, managed, selected."""
    return {"workspaces": _run(service.list, repo)}


@router.post("", status_code=201)
def create_workspace(body: CreateBody, service: WorkspaceService = Depends(get_service)):
    return _run(service.create, body.repo, body.ref, body.branch)


@router.get("/selected")
def get_selected(service: WorkspaceService = Depends(get_service)):
    """The workspace chosen for execution. ``cwd`` is the directory to run in (null when nothing valid is selected).

    Integration point: the run endpoints take ``cwd`` only when it equals the ``rootPath`` of a registered Cowork project
    (``routers/execution.py::_validated_project_cwd``). Registering this ``cwd`` there is the client's explicit step.
    """
    return _run(service.selected)


@router.put("/selected")
def put_selected(body: SelectBody, service: WorkspaceService = Depends(get_service)):
    info = _run(service.select, body.repo, body.id)
    return {"selected": info, "cwd": info["path"], "stale": None}


@router.delete("/selected", status_code=204)
def clear_selected(service: WorkspaceService = Depends(get_service)):
    _run(service.clear_selection)
    return Response(status_code=204)


@router.post("/{workspace_id}/removal-check")
def removal_check(body: CheckBody, workspace_id: str = Path(min_length=1, max_length=64), service: WorkspaceService = Depends(get_service)):
    """Phase 1 of removal: the change report and a confirmation token bound to this exact state."""
    return _run(service.removal_check, body.repo, workspace_id)


@router.post("/{workspace_id}/remove")
def remove_workspace(body: RemoveBody, workspace_id: str = Path(min_length=1, max_length=64), service: WorkspaceService = Depends(get_service)):
    """Phase 2 of removal: only with a token that still matches. Pending work is preserved on a rescue ref first."""
    return _run(service.remove, body.repo, workspace_id, body.confirmation_token, body.release_lock)
