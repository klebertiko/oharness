"""Tools for a registered workspace. All routes inherit sidecar authentication."""
import asyncio
from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from models import CoworkProject
from providers.resolution import ADAPTER_BY_PROVIDER
from routers.execution import _validated_project_cwd
from sandbox.capabilities import capabilities as tool_capabilities
from sandbox.discover import discover as discover_workspace
from sandbox.plan_store import APPROVAL_MODES, DEFAULT_APPROVAL_MODE, PlanError, approve_plan, discard_plan, waiting_plan
from sandbox.hook_store import delete_hook, load_hooks, put_hook
from sandbox.hooks import HOOK_RULES
from sandbox.permission_store import get_thread_mode, is_workspace_trusted, set_thread_mode, set_workspace_trust
from sandbox.read import READ_MAX_BYTES, ReadFailure, read_text
from sandbox.schemas import THREAD_ID_PATTERN, PermissionMode

router = APIRouter(prefix="/chat/tools", tags=["chat-tools"])


@router.get('/capabilities')
async def capabilities(request: Request, cwd: str | None = None, connection_id: str | None = None, db: AsyncSession = Depends(get_db)):
    root = await _validated_project_cwd(db, cwd)
    row = (getattr(request.app.state, 'provider_connections', {}) or {}).get(connection_id, {})
    provider = row.get('provider', 'mock')
    adapter = ADAPTER_BY_PROVIDER.get(provider, provider)
    project = (await db.execute(select(CoworkProject).where(CoworkProject.root_path == cwd))).scalars().first() if root else None
    return tool_capabilities(root, adapter, name=project.name if project else None,
                             unsupported=provider not in ADAPTER_BY_PROVIDER and adapter != 'mock' or not row.get('enabled', True))


@router.get('/discover')
async def discover(cwd: str | None = None, db: AsyncSession = Depends(get_db)):
    root = await _validated_project_cwd(db, cwd)
    if root is None:
        return JSONResponse({'error': 'no-workspace'}, status_code=400)
    return await asyncio.to_thread(discover_workspace, Path(root))


class ReadRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    cwd: str | None = None
    path: str = Field(min_length=1)
    max_bytes: int = Field(default=READ_MAX_BYTES, ge=1, le=READ_MAX_BYTES, strict=True)
    truncate: bool = True


@router.post("/read")
async def read(request: Request, db: AsyncSession = Depends(get_db)):
    raw = None
    try:
        raw = await request.json()
        body = ReadRequest.model_validate(raw)
    except (ValueError, ValidationError):
        return JSONResponse({"error": "invalid_argument", "path": raw.get("path") if isinstance(raw, dict) else None}, status_code=400)
    root = await _validated_project_cwd(db, body.cwd)
    if root is None:
        return JSONResponse({"error": "no-workspace", "path": body.path}, status_code=400)
    try:
        return await asyncio.to_thread(read_text, Path(root), body.path, body.max_bytes, body.truncate)
    except ReadFailure as exc:
        return JSONResponse({"error": exc.code, "path": body.path}, status_code=exc.status)


class PermissionUpdate(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    thread_id: str = Field(pattern=THREAD_ID_PATTERN)
    mode: PermissionMode


@router.get("/permission")
async def get_permission(thread_id: str = Query(pattern=THREAD_ID_PATTERN), db: AsyncSession = Depends(get_db)):
    """Stored permission mode of a conversation (`ask` until someone sets it)."""
    return {"thread_id": thread_id, "mode": await get_thread_mode(db, thread_id)}


@router.put("/permission")
async def put_permission(request: Request, db: AsyncSession = Depends(get_db)):
    """The composer's selector. Only the authenticated sidecar client can call this;
    a model's tool call cannot. There is no bypass mode: unknown values are 400."""
    try:
        body = PermissionUpdate.model_validate(await request.json())
    except (ValueError, ValidationError):
        return JSONResponse({"error": "invalid_argument"}, status_code=400)
    # A plan that waits for approval keeps the conversation in Plan mode: leaving it is what approving does.
    if body.mode != "plan" and await get_thread_mode(db, body.thread_id) == "plan" and await waiting_plan(db, body.thread_id):
        return JSONResponse({"error": "plan_not_approved"}, status_code=409)
    return {"thread_id": body.thread_id, "mode": await set_thread_mode(db, body.thread_id, body.mode)}


class PlanAction(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    thread_id: str = Field(pattern=THREAD_ID_PATTERN)
    plan_id: str = Field(min_length=1, max_length=64)


class PlanApproval(PlanAction):
    mode: str = DEFAULT_APPROVAL_MODE


@router.get("/plan")
async def get_plan(thread_id: str = Query(pattern=THREAD_ID_PATTERN), db: AsyncSession = Depends(get_db)):
    """The plan waiting for approval in this conversation, if any (restores the card after a reload)."""
    return {"thread_id": thread_id, "plan": await waiting_plan(db, thread_id)}


async def _plan_action(request: Request, model, action):
    try:
        body = model.model_validate(await request.json())
        if isinstance(body, PlanApproval) and body.mode not in APPROVAL_MODES:
            raise ValueError("mode")
    except (ValueError, ValidationError):
        return JSONResponse({"error": "invalid_argument"}, status_code=400)
    try:
        return await action(body)
    except PlanError as exc:
        return JSONResponse({"error": exc.code}, status_code=exc.status)


@router.post("/plan/approve")
async def approve(request: Request, db: AsyncSession = Depends(get_db)):
    """Approve the waiting plan: the conversation leaves Plan mode for Ask (or the stricter-than-Full mode named).
    Only the authenticated client can do this; a model's tool call cannot reach it."""
    return await _plan_action(request, PlanApproval, lambda b: approve_plan(db, b.thread_id, b.plan_id, b.mode))


@router.post("/plan/discard")
async def discard(request: Request, db: AsyncSession = Depends(get_db)):
    return await _plan_action(request, PlanAction, lambda b: discard_plan(db, b.thread_id, b.plan_id))


class TrustUpdate(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    cwd: str = Field(min_length=1)
    trusted: bool


@router.get("/trust")
async def get_trust(cwd: str, db: AsyncSession = Depends(get_db)):
    """Whether the person trusted this workspace (false until they say so)."""
    root = await _validated_project_cwd(db, cwd)
    if root is None:
        return JSONResponse({"error": "no-workspace"}, status_code=400)
    return {"cwd": root, "trusted": await is_workspace_trusted(db, root)}


@router.put("/trust")
async def put_trust(request: Request, db: AsyncSession = Depends(get_db)):
    """The UI's explicit "trust this workspace" action. Only registered Cowork projects can be trusted;
    a run request cannot set it and a model's tool call cannot reach it."""
    try:
        body = TrustUpdate.model_validate(await request.json())
    except (ValueError, ValidationError):
        return JSONResponse({"error": "invalid_argument"}, status_code=400)
    root = await _validated_project_cwd(db, body.cwd)
    if root is None:
        return JSONResponse({"error": "no-workspace"}, status_code=400)
    return {"cwd": root, "trusted": await set_workspace_trust(db, root, body.trusted)}


# -- pre-tool hooks (#165) ----------------------------------------------------
def _hook_view(hook) -> dict:
    return {'id': hook.id, 'argv': hook.argv, 'timeout_s': hook.timeout_s, 'tools': list(hook.tools), 'invalid': hook.invalid}


@router.get('/hooks')
async def list_hooks(db: AsyncSession = Depends(get_db)):
    return {'hooks': [_hook_view(h) for h in await load_hooks(db)], 'rules': HOOK_RULES}


@router.put('/hooks/{hook_id}')
async def put_tool_hook(hook_id: str, body: dict, db: AsyncSession = Depends(get_db)):
    try:
        return _hook_view(await put_hook(db, hook_id, body))
    except ValueError:
        return JSONResponse({'error': 'invalid_hook'}, status_code=400)


@router.delete('/hooks/{hook_id}')
async def delete_tool_hook(hook_id: str, db: AsyncSession = Depends(get_db)):
    return {'deleted': await delete_hook(db, hook_id)}
