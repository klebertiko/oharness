"""Revert one file a turn changed (#163). Inherits sidecar authentication."""
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from sandbox.turn_diff import RevertRefused
from sandbox.turn_diff_store import revert_change

router = APIRouter(prefix="/execute", tags=["turn-diff"])


@router.post('/{run_id}/turn-diff/revert')
async def revert_one(run_id: str, body: dict, db: AsyncSession = Depends(get_db)):
    path = body.get('path') if isinstance(body, dict) else None
    if not isinstance(path, str) or not path:
        return JSONResponse({'error': 'invalid_argument'}, status_code=400)
    try:
        return {'path': path, 'status': await revert_change(db, run_id, path)}
    except KeyError:
        return JSONResponse({'error': 'not_found'}, status_code=404)
    except RevertRefused as exc:
        # A path that leaves the workspace can only come from a tampered row: report it as unknown.
        code = 404 if exc.code == 'path_escapes_root' else 409
        return JSONResponse({'error': exc.code}, status_code=code)
