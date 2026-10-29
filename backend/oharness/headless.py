"""`oharness run --mode live|local`: the sidecar's own run path (budget gate, provider resolution, redacted journal) without the sidecar.

It calls the same `_execute_run` the HTTP route calls, so the rules that protect an app run protect this one: the global budget is
checked before any spend, a node only reaches a Provider the person connected, every event is redacted before it is journaled and
printed, and a workspace is honoured only when it is a registered project. What a terminal cannot do is answer a question, so a
human checkpoint (HITL) stops the run instead of being approved (ADR 0045).
"""
from __future__ import annotations

import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

EXIT_RUN_FAILED, EXIT_INVALID = 1, 2


class Refusal(Exception):
    """The run was refused before it started; ``exit_code`` is what the terminal gets."""

    def __init__(self, message: str, exit_code: int = EXIT_INVALID):
        super().__init__(message)
        self.exit_code = exit_code


def parse_frame(chunk: str) -> tuple[str, dict]:
    """One engine SSE frame (`event: x` / `data: {...}`) as (event, data)."""
    import json

    event, _, rest = chunk.partition("\n")
    return event.removeprefix("event: ").strip(), json.loads(rest.removeprefix("data: ").strip())


def run_graph(bundle: dict) -> dict:
    """The shape the engine and the run routes take: nodes/edges at the top, the bundle's `runtime` beside them. Mock and live use this one."""
    return {**bundle["graph"], "runtime": bundle.get("runtime")}


def _backend_on_path() -> None:
    import os

    backend = str(Path(__file__).resolve().parent.parent)  # `engine`, `routers`, `database`... are top-level modules of the backend
    if backend not in sys.path:
        sys.path.insert(0, backend)
    if "DATABASE_URL" not in os.environ:  # the app's own data directory (database, secrets), as the packaged sidecar configures it, not ./data
        from sidecar_entry import configure_environment

        configure_environment()


async def load_runtime():
    """The stored Provider connections and the secrets store, the way the sidecar loads them at startup (and nothing else it does at startup:
    in particular it does not mark other processes' running runs as interrupted)."""
    _backend_on_path()
    from database import SessionLocal
    from providers.store import load_all
    from secret_store.factory import build_secrets_store

    async with SessionLocal() as session:
        connections = await load_all(session)
    return connections, build_secrets_store()


async def stream_live(bundle: dict, mode: str, workspace: str | None, worktree: bool):
    """Yield (event, data) for a real run. Raises ``Refusal`` when the run cannot start."""
    _backend_on_path()
    from fastapi import HTTPException
    from starlette.requests import Request

    from database import SessionLocal, init_db
    from engine import RUNS
    from routers.execution import ExecuteRequest, _execute_run, _validated_project_cwd

    await init_db()  # the tables a first-ever run needs, as the sidecar creates them at startup
    connections, secrets_store = await load_runtime()
    app = SimpleNamespace(state=SimpleNamespace(provider_connections=connections, secrets_store=secrets_store))
    request = Request({"type": "http", "app": app})
    graph = run_graph(bundle)

    async with SessionLocal() as db:
        cwd = None
        if workspace:
            cwd = await _validated_project_cwd(db, workspace)
            if cwd is None:  # the app quietly ignores an unknown folder; a terminal user asked for it by name, so say no
                raise Refusal("the workspace is not a project registered in OHarness (or its folder is gone): add it as a project first")
        try:
            response = await _execute_run(ExecuteRequest(graph_json=graph, mode=mode, cwd=workspace, worktree=worktree), request, db)
        except HTTPException as exc:
            detail = (exc.detail.get("message") or exc.detail.get("code")) if isinstance(exc.detail, dict) else exc.detail
            detail = detail or f"HTTP {exc.status_code}"
            raise Refusal(str(detail), EXIT_RUN_FAILED if exc.status_code == 402 else EXIT_INVALID) from exc
        run_id = response.headers.get("X-Execution-Id") or str(uuid.uuid4())
        try:
            async for chunk in response.body_iterator:
                name, data = parse_frame(chunk)
                yield name, data
                if name == "hitl_pause" and run_id in RUNS:  # nobody here to approve: end the run at the checkpoint
                    RUNS[run_id].stop.set()
                    RUNS[run_id].release()
        finally:  # however the consumer stops, the run is ended and its worktree and journal are settled
            if run_id in RUNS:
                RUNS[run_id].stop.set()
            await response.body_iterator.aclose()
