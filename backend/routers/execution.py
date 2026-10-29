import asyncio
import json
from dataclasses import dataclass
import logging
import re
import time
import uuid

import anyio
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import usage_tracking
from database import SessionLocal, get_db
from models import Harness, ExecutionLog, CoworkProject, RunRecord, RunEvent, RunArtifact, RunInput, RunLink
from run_worktree import RunWorktree, require_workspace
from run_store import RunWriter, metadata, event_view, artifact_view, journal_stream, lineage, is_resumable, continue_run, resume_seed, claim_start, release_start
from adapters import get_adapter, AdapterConfig
from run_budget import STATUS_BUDGET_EXCEEDED, RunBudget, validate_max_tokens
from engine import RUNS, RunControl, STATUS_COMPLETE, STATUS_ERROR, STATUS_STOPPED, _sse, execute_harness
from triage import decide_with_laya, route_message
from usage_tracking import BudgetExceededError
from providers.resolution import ProviderResolutionError, resolve_node_provider
from providers.outcomes import failure_details
from sandbox.approval import ApprovalConflict
from sandbox.turn_diff_store import TurnTracker
from sandbox.hook_store import load_hooks
from sandbox.broker import ToolBroker
from sandbox.permission import effective_mode
from sandbox.permission_store import get_thread_mode, is_workspace_trusted
from sandbox.plan_store import propose_plan
from sandbox.schemas import ToolsRequest

router = APIRouter(prefix="/execute", tags=["execution"])


class ExecuteRequest(BaseModel):
    harness_id: str | None = None
    graph_json: dict | None = None
    mode: str = "mock"  # mock | live | local
    step: bool = False
    instruction: str | None = None
    cwd: str | None = None
    worktree: bool = False  # run in a worktree of its own (made from `cwd`, removed when the run ends)


class DirectRequest(BaseModel):
    """One adapter turn — no harness graph. Same SSE vocabulary as /execute/."""

    instruction: str
    connection_id: str | None = None
    mode: str = "mock"  # mock | live | local
    adapter: str | None = None
    model: str | None = None
    step: bool = False
    cwd: str | None = None
    tools: Any = None
    # Per-run token ceiling (#164); the range lives in run_budget.RUN_BUDGET_RULES.
    max_tokens: Any = None


async def _load_hooks_now():
    async with SessionLocal() as session:
        return await load_hooks(session)


async def _validated_project_cwd(db: AsyncSession, requested: str | None) -> str | None:
    """`ExecuteRequest.cwd` / `DirectRequest.cwd` are a raw string off the
    wire — the composer's WorkspacePicker only ever sends a real Cowork
    project's `rootPath`, but the sidecar endpoint itself has no way to know
    that the caller was the app's own frontend rather than anything else on
    the machine that can reach localhost:8000. So this is the one place that
    trust decision gets made: `requested` is only ever honored when it is
    the exact `root_path` of a project that still exists in `cowork_projects`
    *and* still resolves to a real directory on this disk — anything else
    (never registered, renamed, deleted since it was picked) degrades to
    None, the same "safe default, no error" treatment `cli_shared.resolve_cwd`
    already gives an unresolvable cwd downstream. The validated, resolved
    path is what every downstream caller (`resolve_node_provider`, direct
    mode, `triage.route_message`'s intake call) receives as both
    `extra["cwd"]` and `extra["cwd_root"]` — never the raw, unvalidated
    request string."""
    if not requested:
        return None
    result = await db.execute(select(CoworkProject).where(CoworkProject.root_path == requested))
    project = result.scalars().first()
    if project is None:
        return None
    try:
        # The stored root (equal to `requested`, but read from the database), never the request string itself.
        p = Path(project.root_path).resolve()
        if p.is_dir():
            return str(p)
    except OSError:
        pass
    return None


class ControlRequest(BaseModel):
    action: str  # stop | step | resume
    decision: str | None = None  # approve | reject  (hitl only)
    note: str | None = None
    text: str | None = None  # message (steering) only
    call_id: str | None = None


def _parse_sse_chunk(chunk: str) -> dict | None:
    """Reverse `engine._sse()` — `"event: X\\ndata: Y\\n\\n"` back to
    `{"event": X, "data": <parsed Y>}`. Mirrors the frontend's own parsing in
    `runClient.ts`'s `pumpSse` (same wire format, same tolerance: an
    unparseable frame is dropped, not fatal to the run)."""
    event_match = re.search(r"^event: (.+)$", chunk, re.MULTILINE)
    data_match = re.search(r"^data: (.+)$", chunk, re.MULTILINE)
    if not event_match or not data_match:
        return None
    try:
        data = json.loads(data_match.group(1))
    except ValueError:
        return None
    return {"event": event_match.group(1).strip(), "data": data}


def _first_provider_ids(graph: dict) -> list[str]:
    """The connection routing (and a chat-only reply, if routing decides
    this doesn't need the full graph) should use — every real node the
    composer builds pins the same connection, so the first node with any
    `providerIds` speaks for the whole run."""
    for node in graph.get("nodes", []):
        ids = node.get("data", {}).get("providerIds")
        if ids:
            return list(ids)
    return []


async def _enforce_node_budget(model: str | None, residence: str | None) -> None:
    """`engine.execute_harness`'s `enforce_budget` callback for a harness
    graph run — called once per real node, from inside the node loop
    itself, right after that node's own `resolve_node_provider()` result is
    known. Opens its own fresh session, the same reason the
    `event_stream()` finally-block below does: the request-scoped `db`
    dependency is torn down long before the node loop — which runs inside
    the SSE generator — gets to it. Reuses `usage_tracking.
    enforce_budget_or_raise` unchanged; the only thing that moved is *when*
    and *with which node's* model/residence it gets called (SEC P2-4
    re-review, 2026-09-15 — see that function's own docstring for the
    unpriced/non-local refusal it performs, and the removed
    `_first_provider_model_and_residence` this replaces for why sampling
    one node up front to preview the whole graph was unsafe)."""
    async with SessionLocal() as session:
        # model_expected=True: this callback only ever fires after a real
        # resolve_node_provider() succeeded for this node, so an empty model
        # means a CLI adapter falling back to its own invisible default, not
        # "nothing known yet" — see enforce_budget_or_raise's own docstring
        # (QA re-review, 2026-09-15: this was the OpenAI-shaped silent gap).
        await usage_tracking.enforce_budget_or_raise(
            session, model=model, residence=residence, model_expected=True
        )


def _reply_only_events(run_id: str, mode: str, routed, elapsed_ms: int = 0) -> list[dict]:
    """The full SSE event sequence for a routed-direct reply — same shape a
    real one-node harness run would produce (run_start/node_start/
    node_phase/node_stream/node_done/harness_done), so the frontend needs no
    special case: `Transcript`/`HistoricalRunDetail` render this exactly
    like any other run. No second adapter call — `routed.reply` already IS
    the answer (triage.route_message's whole point).

    The durations are the real ones: the node's `latency_ms` is the timed
    adapter call (`routed.latency_ms`) and `elapsed_ms` is the whole routing
    step as the handler timed it. A literal 0 here used to reach the UI as
    "0ms" / "— elapsed" for every plain chat answer; an unmeasured value is
    now simply 0 only when nothing was timed, which the UI reads as "not
    captured" rather than as a measurement."""
    node_view = {
        "node_id": "reply",
        "type": "agent",
        "label": "Nilo",
        "adapter": routed.adapter_name,
        "model": routed.model,
        "connection_id": routed.connection_id,
        "intrinsic": False,
    }
    return [
        {
            "event": "run_start",
            "data": {"run_id": run_id, "mode": mode, "step": False, "order": [node_view], "unreachable": []},
        },
        {"event": "node_start", "data": node_view},
        {"event": "node_phase", "data": {"node_id": "reply", "phase": "writing", "detail": routed.adapter_name}},
        {"event": "node_stream", "data": {"node_id": "reply", "chunk": routed.reply}},
        {
            "event": "node_done",
            "data": {"node_id": "reply", "output": routed.reply, "tokens": routed.tokens,
                     "tokens_estimated": routed.tokens_estimated,
                     "latency_ms": routed.latency_ms, "connection_id": routed.connection_id,
                     "provider_verified": bool(routed.connection_id)},
        },
        {
            "event": "harness_done",
            "data": {"status": "complete", "total_tokens": routed.tokens,
                     "tokens_estimated": routed.tokens_estimated,
                     "elapsed_ms": max(elapsed_ms, routed.latency_ms), "nodes_run": 1},
        },
    ]


def _route_decision_event(routed) -> dict:
    """Observable provenance for the front-door cascade (ADR-0006)."""
    return {
        "event": "route_decision",
        "data": {
            "source": routed.decision_source,
            "reason": routed.decision_reason,
            "engage_harness": routed.engage_harness,
            "confidence": routed.decision_confidence,
            "latency_ms": routed.decision_latency_ms,
        },
    }


def _usage_rows_from_events(
    events: list[dict], *, run_id: str, source: str, connections: dict[str, dict] | None
) -> list[dict]:
    """Turn one run's already-collected SSE events into ledger-row kwargs for
    `usage_tracking.record_usage_rows`.

    Pairs each `node_start` (the only event carrying adapter/model/
    connection_id) with the `node_done` *or* `node_error` that follows it
    for the same `node_id` (an over-limit node — engine.py's per-agent
    token-limit check — reports real spend on `node_error` too, via its
    `tokens` field, precisely so this still counts it). Nothing else here
    decides what counts as real spend: `usage_tracking.record_usage` already
    refuses `tokens <= 0` and the `mock`/`unresolved` adapters, so this is
    just assembly, not a second policy."""
    connections = connections or {}
    starts: dict[str, dict] = {}
    rows: list[dict] = []
    for evt in events:
        name, data = evt.get("event"), evt.get("data") or {}
        node_id = data.get("node_id")
        if not node_id:
            continue
        if name == "node_start":
            starts[node_id] = data
        elif name in ("node_done", "node_error"):
            tokens = int(data.get("tokens", 0) or 0)
            if tokens <= 0:
                continue
            start = starts.get(node_id, {})
            connection_id = start.get("connection_id")
            provider = (connections.get(connection_id) or {}).get("provider", "") if connection_id else ""
            rows.append(
                dict(
                    run_id=run_id,
                    node_id=node_id,
                    source=source,
                    connection_id=connection_id,
                    provider=provider,
                    adapter=start.get("adapter", ""),
                    model=start.get("model", ""),
                    tokens_total=tokens,
                )
            )
    return rows


def _budget_warning_event(status: usage_tracking.BudgetStatus) -> dict:
    return {
        "event": "budget_warning",
        "data": {
            "spentUsd": round(status.spent_usd, 2),
            "limitUsd": status.limit_usd,
            "pct": status.pct,
        },
    }


def _apply_instruction(graph: dict, instruction: str | None) -> dict:
    """
    Seed the run with the operator's instruction.

    A harness usually starts at an `input` node holding a stored prompt. When a
    person types into the composer they are replacing that prompt for this run
    only, so the graph is copied rather than mutated — the saved harness on disk
    must not silently change because someone pressed Enter.
    """
    if not instruction:
        return graph
    nodes = []
    seeded = False
    for node in graph.get("nodes", []):
        if node.get("type") == "input" and not seeded:
            data = {**node.get("data", {}), "prompt": instruction}
            nodes.append({**node, "data": data})
            seeded = True
        else:
            nodes.append(node)
    return {**graph, "nodes": nodes}


@dataclass
class ResumeSeed:
    """A continued run (ADR 0044): the already-created run to execute and the outputs it starts from."""
    run_id: str
    outputs: dict[str, str]
    sequence: int
    base_ref: str | None = None  # a worktree run starts from the rescue ref that kept the earlier run's edits


@router.post("/")
async def run_harness(body: ExecuteRequest, request: Request, db: AsyncSession = Depends(get_db)):
    return await _execute_run(body, request, db)


async def _execute_run(body: ExecuteRequest, request: Request, db: AsyncSession, resume: ResumeSeed | None = None):
    if body.harness_id:
        h = await db.get(Harness, body.harness_id)
        if not h:
            raise HTTPException(404, "Harness not found")
        graph = json.loads(h.graph_json)
        name = h.name
    elif body.graph_json:
        graph = body.graph_json
        name = "Ad-hoc execution"
    else:
        raise HTTPException(400, "Provide harness_id or graph_json")

    graph = _apply_instruction(graph, body.instruction)

    connections = getattr(request.app.state, "provider_connections", None)
    secrets_store = getattr(request.app.state, "secrets_store", None)
    cwd = await _validated_project_cwd(db, body.cwd)
    require_workspace(body.worktree, cwd)
    isolation = RunWorktree(cwd, ref=(resume.base_ref if resume else None) or "HEAD") if body.worktree else None

    # Global budget gate — checked before *any* real spend, including the
    # routing call just below (it already invokes a real adapter). "mock" is
    # Studio's own authoring/testing mode: it never reaches a real vendor and
    # never costs anything, so it is never blocked by a budget that exists to
    # cap real spend. `budget_status` (None in mock mode) rides into
    # event_stream() below to surface a non-blocking 80%-threshold warning.
    #
    # This no longer previews a model/residence: a graph is a walk, and no
    # single node up front can honestly speak for what every node will
    # resolve to (SEC P2-4 re-review, 2026-09-15 — the prior
    # `_first_provider_model_and_residence` sampled the first node with a
    # `providerIds` field, which a later unpriced node or an intrinsic decoy
    # node could defeat). This call now only refuses a run outright when the
    # budget is already exhausted/invalid — a check that has no positional
    # problem, since it doesn't depend on which node is about to spend. The
    # per-node, engine-resolved version of the unpriced-model check now lives
    # in `execute_harness`'s node loop itself, via `_enforce_node_budget`
    # below — see engine.py's `enforce_budget` parameter.
    budget_status: usage_tracking.BudgetStatus | None = None
    if body.mode != "mock":
        try:
            budget_status = await usage_tracking.enforce_budget_or_raise(db)
        except BudgetExceededError as exc:
            raise HTTPException(402, str(exc)) from exc

    # Route: skip the full 9-role graph (and its HITL gate) for a message
    # that plainly isn't a work item — "mock" is Studio's own authoring/
    # testing mode and always runs the graph as drawn, unaffected by this.
    # One call decides *and*, when it doesn't route to the harness, already
    # contains the final answer — see triage.route_message's module
    # docstring for why this isn't a separate classify-then-reply round trip.
    routed = None
    routed_elapsed_ms = 0
    if body.mode in ("live", "local") and body.instruction:
        routing_started = time.perf_counter()
        try:
            routed = await route_message(
                body.instruction,
                _first_provider_ids(graph),
                connections=connections,
                secrets_store=secrets_store,
                cwd=None if isolation is not None else cwd,  # a run asked to be isolated never lets the intake turn touch the main checkout
                # SEC P2-5, 2026-09-15: this call already spends real tokens
                # regardless of which way routing decides, and it used to run
                # completely outside the budget gate — the most common path
                # of all (plain chat) was silently unprotected. Same callback
                # the harness node loop uses; a refusal here means "this
                # single intake call is refused", never "fall back to the
                # harness" (see route_message's own docstring for why).
                enforce_budget=_enforce_node_budget,
                laya_decide=decide_with_laya,
            )
        except BudgetExceededError as exc:
            raise HTTPException(402, str(exc)) from exc
        routed_elapsed_ms = max(1, round((time.perf_counter() - routing_started) * 1000))
        if not routed.engage_harness:
            name = "Nilo reply (no harness)"

    if resume is None:
        run_id = str(uuid.uuid4())
        log = ExecutionLog(
            id=run_id,
            harness_id=body.harness_id or "adhoc",
            harness_name=name,
            status="running",
        )
        db.add(log)
        db.add(RunRecord(id=run_id, source="harness"))
        await db.flush()
        # What the run started with, so it can be continued later and run the same harness the same way.
        db.add(RunInput(run_id=run_id, graph_json=json.dumps(graph), mode=body.mode, cwd=cwd, worktree=body.worktree))
        await db.commit()
    else:
        run_id = resume.run_id  # created (and claimed) by the continuation; its journal already holds the event that opened it

    control = RunControl(run_id, step=body.step)
    RUNS[run_id] = control

    writer = RunWriter(run_id, sequence=resume.sequence if resume else 0)

    async def event_stream():
        status = "error"
        # The step-by-step run detail (`Show run detail` in the chat panel)
        # only ever lived in the frontend's in-memory reducer — a page reload
        # lost it even though the chat bubble's summary text survived. Record
        # the real events here (not just a count, which is what this used to
        # store) so GET /execute/logs/{id} can replay them into the same
        # reducer client-side after a reload.
        events: list[dict] = []
        run_cwd = cwd
        try:
            if budget_status is not None and budget_status.state == "warning":
                warn_evt = _budget_warning_event(budget_status)
                events.append(warn_evt)
                yield _sse(warn_evt["event"], warn_evt["data"])
            if routed is not None:
                route_evt = _route_decision_event(routed)
                events.append(route_evt)
                yield _sse(route_evt["event"], route_evt["data"])
            if routed is not None and not routed.engage_harness:
                for evt in _reply_only_events(run_id, body.mode, routed, routed_elapsed_ms):
                    events.append(evt)
                    if evt["event"] == "harness_done":
                        status = evt["data"]["status"]
                    yield _sse(evt["event"], evt["data"])
            else:
                if isolation is not None:  # only a run that really executes the harness gets a worktree
                    try:
                        run_cwd = await isolation.open()
                    except RuntimeError as exc:  # the manager's own refusal, already scrubbed: shown as is rather than as a provider failure
                        for evt in ({"event": "error", "data": {"error": str(exc)}},
                                    {"event": "harness_done", "data": {"status": "error", "total_tokens": 0, "tokens_estimated": False,
                                                                       "elapsed_ms": 0, "nodes_run": 0}}):
                            events.append(evt)
                            yield _sse(evt["event"], evt["data"])
                        status = "error"
                        return
                    ready_evt = {"event": "worktree_ready", "data": {"workspace_id": isolation.workspace_id}}  # the id, never the path
                    events.append(ready_evt)
                    yield _sse(ready_evt["event"], ready_evt["data"])
                # A run in its own worktree keeps its work through the rescue ref instead; the diff covers the shared folder.
                tracker = TurnTracker(run_cwd, run_id) if run_cwd and isolation is None else None
                if tracker:
                    await tracker.begin()
                async for chunk in execute_harness(
                    graph,
                    execution_mode=body.mode,
                    control=control,
                    run_id=run_id,
                    connections=connections,
                    secrets_store=secrets_store,
                    cwd=run_cwd,
                    enforce_budget=_enforce_node_budget,
                    resume_outputs=resume.outputs if resume else None,
                ):
                    parsed = _parse_sse_chunk(chunk)
                    if parsed and parsed["event"] == "harness_done" and tracker:
                        # Last word of the run: what it changed in the folder, ahead of the closing event.
                        turn_diff = await tracker.finish(SessionLocal)
                        if turn_diff:
                            events.append({"event": "turn_diff", "data": turn_diff})
                            yield _sse("turn_diff", turn_diff)
                    if parsed:
                        events.append(parsed)
                        if parsed["event"] == "harness_done":
                            status = parsed["data"].get("status", "complete")
                    yield chunk
        except GeneratorExit:
            control.stop.set()
            status = "interrupted"
            raise
        except asyncio.CancelledError:
            # The client hung up. Unwind the run rather than leaking a control
            # handle that nothing will ever release.
            control.stop.set()
            status = "stopped"
            raise
        except Exception as exc:  # noqa: BLE001
            status = "error"
            evt = {"event": "error", "data": failure_details(exc)}
            events.append(evt)
            yield _sse(evt["event"], evt["data"])
        finally:
            RUNS.pop(run_id, None)
            # A fresh session: the request-scoped one is torn down by its
            # dependency and cannot be relied on inside a streaming generator.
            try:
                await writer.finish(status)
            finally:  # the worktree goes whether or not the journal write succeeded
                if isolation is not None:
                    rescue = await isolation.close()
                    if isolation.closed_id is not None:
                        await writer.append({"event": "worktree_closed", "data": {"workspace_id": isolation.closed_id, "rescue_ref": rescue}})
            with anyio.CancelScope(shield=True):
                await persist_usage(events)

    async def persist_usage(events):
        async with SessionLocal() as session:
            # The run's outcome is known now — this is the ledger's one
            # write point (see models.UsageRecord's docstring). Real
            # spend only: usage_tracking.record_usage already refuses
            # zero-token and mock/unresolved turns, so mock-mode runs
            # and a run that failed before any adapter call contribute
            # nothing here, by construction rather than a special case.
            usage_rows = _usage_rows_from_events(
                events, run_id=run_id, source="harness", connections=connections
            )
            # The triage/intake call above (if any) already spent real
            # tokens deciding whether to engage the harness. When it
            # routed to a direct reply instead, that spend is already in
            # `events` above (via `_reply_only_events`, tagged
            # source="harness"). When it decided to engage the harness,
            # `routed` was otherwise only read for its `.engage_harness`
            # flag and this real spend was silently dropped — recorded
            # here, under its own `source="triage"`, so it is never lost
            # (SEC P3-2). `record_usage` already refuses a zero-token or
            # no-adapter row, same guard `_usage_rows_from_events` above
            # already relies on for the same reason.
            if routed is not None and routed.engage_harness and routed.tokens > 0:
                usage_rows.append(
                    dict(
                        run_id=run_id,
                        node_id=None,
                        source="triage",
                        connection_id=routed.connection_id or None,
                        provider=(
                            (connections or {}).get(routed.connection_id) or {}
                        ).get("provider", "") if routed.connection_id else "",
                        adapter=routed.adapter_name,
                        model=routed.model,
                        tokens_total=routed.tokens,
                    )
                )
            await usage_tracking.record_usage_rows(session, usage_rows)
            await session.commit()

    return StreamingResponse(
        journal_stream(event_stream(), writer, _parse_sse_chunk, _sse),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Execution-Id": run_id,
        },
    )


@router.post("/direct")
async def run_direct(body: DirectRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """
    Thin passthrough: one synthetic llm node, one adapter turn, no graph walk.

    Exists so Agent mode can run with harness disabled while still speaking the
    same SSE dialect the agent-run panel already understands (including stop
    via /execute/{run_id}/control).
    """

    prompt = (body.instruction or "").strip()
    try:
        tool_options = ToolsRequest.model_validate(body.tools) if body.tools is not None else None
    except ValidationError:
        return JSONResponse({'error': 'invalid_argument'}, status_code=400)
    try:
        run_budget = RunBudget(validate_max_tokens(body.max_tokens))
    except ValueError:
        return JSONResponse({'error': 'invalid_run_budget'}, status_code=400)
    preset_only = tool_options is not None and tool_options.preset is not None and not tool_options.summarize
    if not prompt and not (tool_options and tool_options.preset):
        raise HTTPException(400, "instruction is required")

    cwd = await _validated_project_cwd(db, body.cwd)
    connections = getattr(request.app.state, "provider_connections", {}) or {}

    # Same global budget gate as POST /execute/ — see that handler's comment
    # for why "mock" is exempt. Checked *after* real resolution, not a
    # pre-resolution guess (SEC P2-5, 2026-09-15): a preview built from
    # `body.model`/the connection's `defaultModel` was almost always empty
    # in practice — the composer never sends a model at all, and no UI
    # surface writes `defaultModel` — so the check silently never fired for
    # the single most common path (plain chat, no harness). Using
    # `resolved`'s own values, with `model_expected=True`, treats "resolved
    # a connection but still don't know its model" as the least-known case
    # there is, matching `engine.py`'s per-node harness-loop check exactly.
    node_id = "direct"
    connection_id = None
    budget_status: usage_tracking.BudgetStatus | None = None
    if body.mode == "mock":
        adapter_name = "mock"
        adapter = get_adapter("mock")
        config = AdapterConfig(adapter="mock", model=body.model or "mock-1")
    else:
        try:
            resolved = resolve_node_provider(
                {"providerIds": [body.connection_id] if body.connection_id else [], "model": body.model},
                "llm", "Nilo", connections=connections,
                secrets_store=getattr(request.app.state, "secrets_store", None), cwd=cwd,
            )
        except ProviderResolutionError as exc:
            raise HTTPException(400, str(exc)) from exc
        adapter_name, adapter, config = resolved.adapter_name, resolved.adapter, resolved.config
        connection_id = resolved.connection_id
        try:
            budget_status = None if preset_only else await usage_tracking.enforce_budget_or_raise(
                db,
                model=config.model or None,
                residence=connections.get(connection_id, {}).get("residence"),
                model_expected=True,
            )
        except BudgetExceededError as exc:
            raise HTTPException(402, str(exc)) from exc
    model = config.model
    run_id = str(uuid.uuid4())
    db.add(ExecutionLog(
        id=run_id, harness_id="direct", harness_name="Direct execution", status="running",
        result_json=json.dumps({"source": "direct", "events": []}),
    ))
    db.add(RunRecord(id=run_id, source="direct"))
    await db.commit()
    control = RunControl(run_id, step=body.step)
    RUNS[run_id] = control
    control.tool_mode = tool_options is not None
    permission_mode = None
    workspace_trusted = False
    if tool_options:
        # The conversation's stored mode is the ceiling; the request can only tighten it.
        stored = await get_thread_mode(db, tool_options.thread_id)
        permission_mode = effective_mode(stored, tool_options.permission_mode)
        workspace_trusted = await is_workspace_trusted(db, cwd)
    broker = ToolBroker(cwd, adapter_name, control, tool_options, permission_mode=permission_mode, workspace_trusted=workspace_trusted,
                        run_budget=run_budget, hooks_loader=_load_hooks_now) if tool_options else None
    node_view = {
        "node_id": node_id,
        "type": "llm",
        "label": "Direct",
        "adapter": adapter_name,
        "model": model,
        "connection_id": connection_id,
        "intrinsic": False,
    }

    writer = RunWriter(run_id)

    async def event_stream():
        status = STATUS_ERROR
        total_tokens = 0
        node_tokens = 0
        tokens_estimated = False
        collected: list[str] = []
        nodes_run = 0
        started = time.time()
        budget_hit = None

        def emit(event: str, data: dict) -> str:
            return _sse(event, data)

        tracker = TurnTracker(cwd, run_id) if cwd else None
        try:
            if tracker:
                await tracker.begin()
            if broker:
                yield emit('capabilities', {'node_id': node_id, **broker.capabilities, 'permission_mode': broker.permission_mode, 'workspace_trusted': broker.workspace_trusted})
            if budget_status is not None and budget_status.state == "warning":
                warn_evt = _budget_warning_event(budget_status)
                yield emit(warn_evt["event"], warn_evt["data"])
            yield emit(
                "run_start",
                {
                    "run_id": run_id,
                    "mode": body.mode,
                    "step": body.step,
                    "order": [node_view],
                    "unreachable": [],
                },
            )

            if control.stop.is_set():
                status = STATUS_STOPPED
                yield emit("run_stopped", {"at_node": node_id})
            else:
                yield emit("node_start", node_view)
                node_start = time.time()

                try:
                    stream = broker.stream(prompt, adapter, config) if broker else adapter.stream_events(prompt, config)
                    async for ev in control.stream_until_stopped(stream):
                        kind = ev.get("kind")
                        if broker and (kind.startswith(('tool_', 'subagent_')) or kind == 'capabilities'):
                            yield emit(kind, {'node_id': node_id, **{k: v for k, v in ev.items() if k != 'kind'}})
                        elif kind in ("budget_exceeded", "context_compacted"):
                            payload = {k: v for k, v in ev.items() if k != "kind"}
                            if kind == "budget_exceeded":
                                budget_hit = payload
                            yield emit(kind, {"node_id": node_id, **payload})
                        elif kind == "phase":
                            control.phase = ev.get("phase", "")
                            yield emit(
                                "node_phase",
                                {
                                    "node_id": node_id,
                                    "phase": ev.get("phase", ""),
                                    "detail": ev.get("detail", ""),
                                },
                            )
                        elif kind == "reason":
                            yield emit(
                                "node_reason",
                                {"node_id": node_id, "chunk": ev.get("text", "")},
                            )
                        elif kind == "text":
                            collected.append(ev.get("text", ""))
                            yield emit(
                                "node_stream",
                                {"node_id": node_id, "chunk": ev.get("text", "")},
                            )
                            if not broker and run_budget.exceeded((len(prompt) + sum(map(len, collected))) // 4):
                                # A single turn has no tool loop to stop between turns:
                                # stop the stream itself once the estimate crosses the ceiling.
                                used = (len(prompt) + sum(map(len, collected))) // 4
                                budget_hit = {"max_tokens": run_budget.max_tokens, "used_tokens": used}
                                yield emit("budget_exceeded", {"node_id": node_id, **budget_hit})
                                break
                        elif kind == "tool_call":
                            yield emit(
                                "tool_call",
                                {
                                    "node_id": node_id,
                                    "call_id": ev.get("call_id", ""),
                                    "name": ev.get("name", ""),
                                    "args": ev.get("args", ""),
                                },
                            )
                        elif kind == "tool_result":
                            yield emit(
                                "tool_result",
                                {
                                    "node_id": node_id,
                                    "call_id": ev.get("call_id", ""),
                                    "ok": ev.get("ok", True),
                                    "result": ev.get("result", ""),
                                    "duration_ms": ev.get("duration_ms", 0),
                                },
                            )
                        elif kind == "usage":
                            node_tokens = int(ev.get("tokens", 0))

                    output = "".join(collected)
                    # Provenance travels with the count: a usage event means the
                    # provider reported it; the length-based fallback is an estimate.
                    tokens_estimated = False
                    if not node_tokens and (not broker or broker.provider_called):
                        node_tokens = max(1, len(output) // 4)
                        tokens_estimated = True
                    total_tokens = node_tokens
                    nodes_run = 1 if not control.stop.is_set() else 0
                    latency = int((time.time() - node_start) * 1000)

                    if control.stop.is_set():
                        status = STATUS_STOPPED
                        yield emit(
                            "node_done",
                            {
                                "node_id": node_id,
                                "output": output,
                                "tokens": node_tokens,
                                "tokens_estimated": tokens_estimated,
                                "latency_ms": latency,
                            },
                        )
                        yield emit("run_stopped", {"at_node": node_id})
                    else:
                        status = STATUS_COMPLETE
                        if budget_hit is not None:
                            status = STATUS_BUDGET_EXCEEDED
                        yield emit(
                            "node_done",
                            {
                                "node_id": node_id,
                                "output": output,
                                "tokens": node_tokens,
                                "tokens_estimated": tokens_estimated,
                                "latency_ms": latency,
                                "connection_id": connection_id,
                                "provider_verified": connection_id is not None and (not broker or broker.provider_called),
                            },
                        )
                        if broker and stored == "plan" and broker.permission_mode == "plan" and tool_options.preset is None and tool_options.thread_id and output.strip():
                            # Plan mode ends in a plan artifact; nothing executes until a person approves it. Only a plain turn in a conversation
                            # stored in Plan: the approval barrier and the card follow the stored mode, and a `/read` or `/exec` is not a plan.
                            try:
                                async with SessionLocal() as plan_session:
                                    plan = await propose_plan(plan_session, tool_options.thread_id, output)
                            except Exception:  # noqa: BLE001 - the answer was already delivered; only the approval card is missing
                                logging.getLogger(__name__).exception("plan not saved (run %s)", run_id)
                                yield emit("plan_error", {"node_id": node_id, "code": "plan_not_saved"})
                            else:
                                yield emit("plan_proposed", {"node_id": node_id, **plan})
                except Exception as exc:  # noqa: BLE001
                    status = STATUS_ERROR
                    total_tokens = node_tokens
                    yield emit("node_error", {
                        "node_id": node_id, "tokens": node_tokens,
                        "connection_id": connection_id, **failure_details(exc),
                    })

            control.phase = "done"
            turn_diff = await tracker.finish(SessionLocal) if tracker else None
            if turn_diff:
                yield emit("turn_diff", {"node_id": node_id, **turn_diff})
            yield emit(
                "harness_done",
                {
                    "status": status,
                    "total_tokens": total_tokens,
                    "tokens_estimated": tokens_estimated,
                    "elapsed_ms": int((time.time() - started) * 1000),
                    "nodes_run": nodes_run,
                },
            )
        except GeneratorExit:
            control.stop.set()
            status = "interrupted"
            raise
        except asyncio.CancelledError:
            control.stop.set()
            status = STATUS_STOPPED
            total_tokens = node_tokens or len("".join(collected)) // 4
            tokens_estimated = not node_tokens
            # No terminal event was delivered: retain partial journal coverage.
            raise
        except Exception as exc:  # noqa: BLE001
            status = STATUS_ERROR
            # Edits made before the failure are still the person's to review and undo.
            failed_diff = await tracker.finish(SessionLocal) if tracker else None
            if failed_diff:
                yield emit("turn_diff", {"node_id": node_id, **failed_diff})
            yield emit("error", failure_details(exc))
        finally:
            RUNS.pop(run_id, None)
            # One synthetic node, one possible turn — real spend only:
            # record_usage already refuses a mock/unresolved adapter or zero
            # tokens (a stopped-before-anything-streamed run), so this needs
            # no extra guard to keep the ledger real-usage-only.
            # Starlette cancels the response scope on disconnect; finish the log anyway.
            await writer.finish(status)
            with anyio.CancelScope(shield=True):
                async with SessionLocal() as session:
                    if total_tokens > 0:
                        await usage_tracking.record_usage(
                            session,
                            run_id=run_id,
                            node_id=node_id,
                            source="direct",
                            connection_id=connection_id,
                            provider=connections.get(connection_id, {}).get("provider", ""),
                            adapter=adapter_name,
                            model=model,
                            tokens_total=total_tokens,
                        )

    return StreamingResponse(
        journal_stream(event_stream(), writer, _parse_sse_chunk, _sse),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Execution-Id": run_id,
        },
    )


@router.post("/{run_id}/control")
async def control_run(run_id: str, body: ControlRequest):
    """
    Out-of-band control for an in-flight run.

    Kept separate from the SSE response on purpose: the stream is one-way and
    long-lived, and a control action must be able to land (and be acknowledged
    with a real status code) even while the engine is mid-token.
    """
    control = RUNS.get(run_id)
    if not control:
        raise HTTPException(404, "Run is not active")

    action = body.action
    if action == "stop":
        control.stop.set()
        control.release()
    elif action in ("step", "resume"):
        if control.tool_mode and (body.decision or body.call_id or control.tool_approval.pending):
            try:
                control.tool_approval.decide(body.call_id, body.decision or '', body.note or '')
            except ApprovalConflict as exc:
                return JSONResponse({'error': str(exc), 'pending_call_id': control.tool_approval.pending}, status_code=409)
            except ValueError:
                return JSONResponse({'error': 'invalid_argument'}, status_code=400)
            return {'ok': True, 'run_id': run_id, 'action': action}
        if body.decision:
            control.decision = {"decision": body.decision, "note": body.note or ""}
        control.release()
    elif action == "message":
        if body.text:
            control.inbox.append(body.text)
    else:
        raise HTTPException(400, f"Unknown action: {action}")

    return {"ok": True, "run_id": run_id, "action": action}


@router.get("/active")
async def active_runs():
    return [
        {"run_id": rid, "phase": c.phase, "step": c.step}
        for rid, c in RUNS.items()
    ]


@router.get("/logs")
async def list_logs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ExecutionLog).order_by(ExecutionLog.started_at.desc()).limit(50)
    )
    logs = result.scalars().all()
    return [
        {
            "id": lg.id,
            "harness_id": lg.harness_id,
            "harness_name": lg.harness_name,
            "source": json.loads(lg.result_json or "{}").get("source", "harness"),
            **metadata(await db.get(RunRecord, lg.id)),
            "status": lg.status,
            "started_at": lg.started_at.isoformat() if lg.started_at else None,
            "finished_at": lg.finished_at.isoformat() if lg.finished_at else None,
        }
        for lg in logs
    ]


@router.get("/logs/{log_id}")
async def get_log_detail(log_id: str, db: AsyncSession = Depends(get_db)):
    lg = await db.get(ExecutionLog, log_id)
    if not lg:
        raise HTTPException(404, f"Run '{log_id}' not found")
    record = await db.get(RunRecord, log_id)
    result = json.loads(lg.result_json) if lg.result_json else None
    if record:
        events = (await db.scalars(select(RunEvent).where(RunEvent.run_id == log_id).order_by(RunEvent.sequence))).all()
        result = {"source": record.source, "events": [{"event": e.event_type, "data": json.loads(e.data_json)} for e in events]}
    return {
        **metadata(record),
        **await lineage(db, log_id),
        "resumable": is_resumable(lg, record, await db.get(RunInput, log_id)),
        "id": lg.id,
        "harness_id": lg.harness_id,
        "harness_name": lg.harness_name,
        "source": json.loads(lg.result_json or "{}").get("source", "harness"),
        "status": lg.status,
        "started_at": lg.started_at.isoformat() if lg.started_at else None,
        "finished_at": lg.finished_at.isoformat() if lg.finished_at else None,
        "result": result,
        "artifacts": await list_artifacts(log_id, db),
    }


@router.post("/logs/{log_id}/start")
async def start_continued_run(log_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Execute a continuation made by ``/continue``: finished nodes are restored from the run it continues, the rest run for real.

    A continuation starts once: a second call (double click, retry) is a 409 and executes nothing.
    """
    await _require_log(db, log_id)
    link = await db.get(RunLink, log_id)
    inputs = await db.get(RunInput, log_id)
    if link is None or not await claim_start(db, log_id):
        raise HTTPException(409, {"code": "not_startable", "message": "only a continued run that has not started yet can be started"})
    try:
        if inputs is None:
            raise HTTPException(409, {"code": "inputs_unavailable", "message": "the run this continues was saved before its harness was kept; it cannot be continued"})
        outputs = await resume_seed(db, link.parent_id)
        record = await db.get(RunRecord, log_id)
        if record is None:
            raise HTTPException(409, {"code": "inputs_unavailable", "message": "this continuation has no saved journal"})
        body = ExecuteRequest(graph_json=json.loads(inputs.graph_json), mode=inputs.mode, cwd=inputs.cwd, worktree=inputs.worktree)
        return await _execute_run(body, request, db, ResumeSeed(log_id, outputs, record.last_sequence, inputs.base_ref))
    except BaseException:
        await release_start(db, log_id)
        raise


@router.post("/logs/{log_id}/continue", status_code=201)
async def continue_log(log_id: str, db: AsyncSession = Depends(get_db)):
    """A new run linked to this one, from its durable journal. The parent's events are left exactly as they are."""
    await _require_log(db, log_id)
    child = await continue_run(db, log_id)
    if child is None:
        raise HTTPException(409, {"code": "not_resumable", "message": "only a run that stopped before it finished, and has a saved journal, can be continued"})
    return child


async def _require_log(db, log_id):
    if not await db.get(ExecutionLog, log_id):
        raise HTTPException(404, "Run not found")


@router.get("/logs/{log_id}/events")
async def list_events(log_id: str, after: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500), db: AsyncSession = Depends(get_db)):
    await _require_log(db, log_id)
    record = await db.get(RunRecord, log_id)
    rows = (await db.scalars(select(RunEvent).where(RunEvent.run_id == log_id, RunEvent.sequence > after)
                            .order_by(RunEvent.sequence).limit(limit + 1))).all()
    page = rows[:limit]
    return {**metadata(record), 'events': [event_view(e) for e in page],
            'next_cursor': page[-1].sequence if page else after, 'has_more': len(rows) > limit}


@router.get("/logs/{log_id}/artifacts")
async def list_artifacts(log_id: str, db: AsyncSession = Depends(get_db)):
    await _require_log(db, log_id)
    rows = (await db.scalars(select(RunArtifact).where(RunArtifact.run_id == log_id)
                            .order_by(RunArtifact.event_sequence))).all()
    return [artifact_view(a) for a in rows]


@router.get("/logs/{log_id}/artifacts/{artifact_id}")
async def get_artifact(log_id: str, artifact_id: str, db: AsyncSession = Depends(get_db)):
    artifact = await db.get(RunArtifact, artifact_id)
    if not artifact or artifact.run_id != log_id:
        raise HTTPException(404, "Artifact not found")
    return artifact_view(artifact, content=True)
