"""Cancel one subagent of an in-flight run (#166). Inherits sidecar authentication."""
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from engine import RUNS

router = APIRouter(prefix="/execute", tags=["subagents"])


@router.post('/{run_id}/subagents/{child_id}/cancel')
async def cancel_subagent(run_id: str, child_id: str):
    control = RUNS.get(run_id)
    group = getattr(control, 'subagents', None)
    child = group.get(child_id) if group else None
    if child is None:
        return JSONResponse({'error': 'not_found'}, status_code=404)
    if not group.cancel(child_id):
        return JSONResponse({'error': 'not_running', 'state': child.state}, status_code=409)
    return {'child_id': child_id, 'state': child.state}
