"""
Harness execution engine.

Topologically sorts a node graph, walks it, and streams SSE events describing
everything the run does — not just the text it produced.

The event vocabulary is deliberately wider than "tokens arrived". A harness run
is a traversal of a graph the user drew, so the stream carries the *plan* up
front (`run_start.order`), then per-node phase transitions, tool calls with
their results, human-in-the-loop gates that actually block, and a terminal
verdict. A client that renders only `node_stream` still works; a client that
renders the whole vocabulary can show a person exactly where their graph is.

Control flow (stop / step / HITL resolution / mid-run steering) arrives out of
band through a `RunControl` handle registered in `RUNS`, which the HTTP router
looks up by run id. The generator is the only writer of stream events; the
router only ever sets events and drops payloads into the control object.
"""
import asyncio
import anyio
import httpx
import json
import os
import time
import uuid
from collections import defaultdict, deque
from typing import Any, AsyncIterator, Awaitable, Callable

from adapters import get_adapter, AdapterConfig
from adapters.base import ProbeResult
from providers.resolution import (
    FailoverAttempt,
    ProviderResolutionError,
    resolve_node_provider_with_failover,
)
from providers.outcomes import failure_details
from sandbox.approval import ToolApproval
from runtime.router import select_runtime
from usage_tracking import BudgetExceededError, WARN_THRESHOLD as TOKEN_BUDGET_WARN_THRESHOLD

# ── Terminal states a run can land in ──────────────────────────────────────────
STATUS_COMPLETE = "complete"
STATUS_STOPPED = "stopped"
STATUS_ERROR = "error"


class RunControl:
    """
    Out-of-band handle on an in-flight run.

    `gate` is a single-shot latch the engine waits on whenever it is parked —
    either between nodes in step mode, or at a HITL node. The router sets it;
    the engine clears it after waking. `stop` is sticky: once set the run
    unwinds at the next checkpoint rather than being cancelled mid-token, so
    partial output is never lost.
    """

    def __init__(self, run_id: str, step: bool = False):
        self.run_id = run_id
        self.step = step
        self.stop = asyncio.Event()
        self.gate = asyncio.Event()
        self.tool_approval = ToolApproval(self.gate)
        self.tool_mode = False
        self.decision: dict | None = None
        self.inbox: list[str] = []
        self.phase: str = "starting"
        self.started_at = time.time()

    def release(self) -> None:
        self.gate.set()

    async def park(self) -> bool:
        """Block until released or stopped. Returns False if the run was stopped."""
        stopper = asyncio.create_task(self.stop.wait())
        opener = asyncio.create_task(self.gate.wait())
        done, pending = await asyncio.wait(
            {stopper, opener}, return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
        self.gate.clear()
        return not self.stop.is_set()

    def drain_inbox(self) -> list[str]:
        msgs, self.inbox = self.inbox, []
        return msgs

    async def stream_until_stopped(self, aiter: AsyncIterator[Any]) -> AsyncIterator[Any]:
        """
        Relay `aiter` until it is exhausted or `stop` is set -- whichever
        comes first, checked even while waiting on the *next* item, not only
        in the gaps between items that have already arrived.

        Without this, a slow-yielding adapter (a local model mid-token, a CLI
        subprocess between lines of output) can leave `stop` unchecked for as
        long as the adapter feels like taking -- from the user's seat,
        clicking Stop does nothing until the adapter happens to produce
        something. This still never cancels an item mid-delivery; it only
        stops asking `aiter` for another one once `stop` wins the race
        against the wait for it.
        """
        ait = aiter.__aiter__()
        next_item = stopped = None
        try:
            while True:
                next_item = asyncio.ensure_future(ait.__anext__())
                stopped = asyncio.ensure_future(self.stop.wait())
                done, pending = await asyncio.wait(
                    {next_item, stopped}, return_when=asyncio.FIRST_COMPLETED
                )
                if next_item not in done:
                    next_item.cancel()
                    # Let the cancellation actually land inside `aiter` before
                    # touching it again -- otherwise aclose() below can race
                    # a generator asyncio still considers mid-resume.
                    try:
                        await next_item
                    except (asyncio.CancelledError, StopAsyncIteration):
                        pass
                    return
                stopped.cancel()
                yield next_item.result()
        except StopAsyncIteration:
            return
        finally:
            # A disconnected consumer can cancel asyncio.wait while __anext__
            # is still running. Join it before aclose, preserving cancellation.
            with anyio.CancelScope(shield=True):
                tasks = [task for task in (next_item, stopped) if task is not None]
                for task in tasks:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                aclose = getattr(ait, "aclose", None)
                if aclose is not None:
                    await aclose()


# Live runs, keyed by run id. Entries are removed by the router once the
# stream generator finishes, so a stale id can never be steered.
RUNS: dict[str, RunControl] = {}


# The one Gate output port allowed to close a cycle without the graph being
# treated as structurally broken (frontend/src/lib/ports.ts, PORTS.gate).
_GATE_RETRY_HANDLE = "fail"



def _reachable_from(start_ids: set[str], graph: dict[str, list[str]]) -> set[str]:
    """BFS reachability over an adjacency list, from any of `start_ids`."""
    seen: set[str] = set()
    queue = deque(start_ids)
    while queue:
        nid = queue.popleft()
        if nid in seen:
            continue
        seen.add(nid)
        queue.extend(graph.get(nid, []))
    return seen


def topological_sort(
    nodes: list[dict], edges: list[dict]
) -> tuple[list[str], list[str], list[dict]]:
    """
    Kahn's algorithm. Returns (execution order, unreachable node ids, retry
    edges).

    The second element matters: the original implementation silently dropped
    every node inside a cycle, so a harness with an accidental loop appeared to
    run fine while skipping half the graph. Now the caller can say so out loud.

    The third element is a deliberate, narrow exception to that rule: a Gate
    node's `fail` output wired back to an earlier node is a bounded
    retry/rework loop, not an accidental cycle (Studio canvas "4 errors" false
    positive, 2026-09-17 — a Gate's `fail` port existing at all is the whole
    point of a Gate). An edge only qualifies if it is *actually* what closes a
    cycle: its source is a `gate` node, it leaves on the `fail` port, and —
    judged against every other real edge in the graph (every non-candidate
    edge; deliberately not the other candidates, so classification never
    depends on iteration order) — its target can already reach its source.
    Excluding just that edge from Kahn's in-degree bookkeeping lets the rest
    of the graph resolve normally; this function only decides what's
    structurally safe to treat as a loop. `execute_harness` is the one that
    actually re-runs the loop body at runtime, bounded by an iteration cap.

    A Gate `fail` edge that *doesn't* close a cycle (its target isn't an
    ancestor of the Gate — e.g. it points at a distinct terminal/error node)
    is unaffected by any of this: it behaves exactly as it always has, as a
    normal edge. So does an ordinary cycle with no Gate `fail` edge in it at
    all — that's still a hard, immediate error, same as before.
    """
    node_map = {n["id"]: n for n in nodes}
    valid_ids = set(node_map)

    def _valid(edge: dict) -> bool:
        return edge.get("source") in valid_ids and edge.get("target") in valid_ids

    candidates = [
        e
        for e in edges
        if _valid(e)
        and node_map.get(e["source"], {}).get("type") == "gate"
        and e.get("sourceHandle") == _GATE_RETRY_HANDLE
    ]
    candidate_ids = {id(e) for e in candidates}
    base_edges = [e for e in edges if _valid(e) and id(e) not in candidate_ids]

    base_graph: dict[str, list[str]] = defaultdict(list)
    for e in base_edges:
        base_graph[e["source"]].append(e["target"])

    # Multiple fail edges into the same Gate that both genuinely loop are an
    # unusual shape (not the reported bug, not exercised by any test today);
    # `execute_harness` keys its retry-target lookup by gate id, so only the
    # last such edge below actually wins. Fine as a pragmatic simplification
    # — anything relying on more than one live retry target per Gate should
    # be redesigned as two Gates, not flagged here.
    retry_edges: list[dict] = []
    structural_edges = list(base_edges)
    for e in candidates:
        if e["source"] in _reachable_from({e["target"]}, base_graph):
            retry_edges.append(e)
        else:
            structural_edges.append(e)

    graph: dict[str, list[str]] = defaultdict(list)
    in_degree: dict[str, int] = {n["id"]: 0 for n in nodes}
    for edge in structural_edges:
        graph[edge["source"]].append(edge["target"])
        in_degree[edge["target"]] += 1

    queue = deque(nid for nid, deg in in_degree.items() if deg == 0)
    order: list[str] = []
    while queue:
        nid = queue.popleft()
        order.append(nid)
        for neighbor in graph[nid]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    unreachable = [nid for nid in in_degree if nid not in set(order)]
    return order, unreachable, retry_edges


_DEFAULT_GATE_RETRY_CAP = 3


def _gate_decision(node: dict, output: str, execution_mode: str, prior_attempts: int = 0) -> str:
    """
    "pass" or "fail" for a Gate node's two named out ports (see
    frontend/src/lib/ports.ts PORTS.gate: `pass`/`fail`, tones
    accept/reject).

    `mock` never calls a real adapter, so there is nothing honest to read a
    decision from in the node's own output text — the graph author pins it
    explicitly with `data.mockOutcome`, either a single "pass" | "fail"
    (the same decision every attempt) or a list consumed by attempt number
    (e.g. `["fail", "fail", "pass"]` to exercise a genuine multi-attempt
    rework loop that eventually succeeds; an attempt past the end of the
    list repeats the last entry). Unset defaults to "pass", the same outcome
    a Gate with no fail edge at all always had — exercising the retry branch
    is opt-in, never forced on a graph a person hasn't configured for it.

    live/local modes read the adapter's real output instead, the same
    substring-match convention `edge.data.condition` already uses elsewhere
    in this module (see the conditional-routing block below): "fail" wins if
    the word appears (case-insensitively) anywhere in the output, else "pass".
    """
    data = node.get("data") or {}
    if execution_mode == "mock":
        outcome = data.get("mockOutcome", "pass")
        if isinstance(outcome, list):
            outcome = outcome[min(prior_attempts, len(outcome) - 1)] if outcome else "pass"
        return "fail" if str(outcome).strip().lower() == "fail" else "pass"
    return "fail" if "fail" in (output or "").strip().lower() else "pass"


def _gate_retry_cap(node: dict) -> int:
    data = node.get("data") or {}
    try:
        cap = int(data.get("maxIterations"))
    except (TypeError, ValueError):
        return _DEFAULT_GATE_RETRY_CAP
    return cap if cap > 0 else _DEFAULT_GATE_RETRY_CAP


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# Node types the engine resolves itself, with no adapter round-trip.
# "decision" (EXPERIMENTAL, ADR-0005) included: it calls a separate Laya
# loopback process over plain HTTP, never the provider/adapter path.
_INTRINSIC = {"input", "output", "router", "hitl", "decision"}

# Default port for the EXPERIMENTAL Laya decision-node loopback (ADR-0005) —
# must match backend/laya_loopback/server.py's own `LAYA_LOOPBACK_PORT`
# default. Overridable via the same env var.
_LAYA_LOOPBACK_DEFAULT_PORT = 8761
_LAYA_LOOPBACK_TIMEOUT_S = 60.0


def _node_view(node: dict) -> dict:
    data = node.get("data", {})
    node_type = node.get("type", "llm")
    is_intrinsic = node_type in _INTRINSIC
    return {
        "node_id": node["id"],
        "type": node_type,
        "label": data.get("label") or node_type,
        # Intrinsic nodes (input/output/router/hitl) are resolved entirely by
        # the engine -- no adapter round-trip ever happens for them. Trusting
        # `data.adapter` here let a crafted/imported bundle claim e.g.
        # "claude" on a node that never contacted any vendor, which the
        # frontend could read as "Verified by a real run just now" for
        # whichever connection happened to be selected (SEC P2-1,
        # 2026-09-15). Force it from the engine's own knowledge instead of
        # trusting graph-author-supplied data -- an intrinsic node's adapter
        # is always "mock", full stop.
        "adapter": "mock" if is_intrinsic else data.get("adapter", "mock"),
        "model": data.get("model", ""),
        "intrinsic": is_intrinsic,
    }


async def execute_harness(
    harness_json: dict,
    execution_mode: str = "mock",
    control: RunControl | None = None,
    run_id: str = "",
    user_pref: str | None = None,
    probe: Callable[[str], str | None] | None = None,
    connections: dict[str, dict] | None = None,
    secrets_store: Any = None,
    cwd: str | None = None,
    enforce_budget: Callable[[str | None, str | None], Awaitable[None]] | None = None,
    decision_transport: httpx.BaseTransport | None = None,
) -> AsyncIterator[str]:
    """
    `enforce_budget`, when given, is called as `await enforce_budget(model,
    residence)` once per real (non-mock) node, right after that node's own
    `resolve_node_provider()` result is known and before its adapter is
    ever called -- never with a different node's claim. It should raise
    `usage_tracking.BudgetExceededError` to refuse the node, or return
    normally to let it proceed. `None` (the default, and every call site
    that predates this parameter) skips the check entirely, unchanged from
    prior behaviour. The caller owns the database session/lifecycle this
    needs (see routers/execution.py's `_enforce_node_budget` -- the engine
    itself stays free of any `database` dependency, the same reason
    `connections`/`secrets_store` arrive as plain data rather than live
    handles).

    `decision_transport`, when given, is passed straight to the
    `httpx.AsyncClient` that a `type: "decision"` node (EXPERIMENTAL,
    ADR-0005) uses to call the separate Laya loopback process -- the same
    test seam `adapters/openai_compatible.py` already uses for its own
    `httpx.AsyncClient`. `None` (the default) makes a real loopback call to
    `http://127.0.0.1:<LAYA_LOOPBACK_PORT>/predict`.

    Stream of SSE events:

      run_start         {run_id, mode, order:[node_view], unreachable}
      runtime_selected  {kind, name, reason}         — CLI probe or API fallback
      awaiting_step     {next: node_view}            — parked, step mode
      node_start        {node_id, label, type, adapter, model}
      node_phase        {node_id, phase, detail}     — thinking|tool|writing|done
      node_reason       {node_id, chunk}             — reasoning text
      node_stream       {node_id, chunk}             — answer text
      tool_call         {node_id, call_id, name, args}
      tool_result       {node_id, call_id, ok, result, duration_ms}
      node_done         {node_id, output, tokens, tokens_estimated, latency_ms}
                                                     — `tokens_estimated`: true when the count was derived from
                                                       output length because the adapter reported no usage
      node_error        {node_id, error, tokens?}      — `tokens` present only when real spend
                                                          happened before the failure (e.g. an
                                                          over-limit node, see node_token_warning)
      node_token_warning {node_id, tokens, limit, pct} — this node's own usage crossed 80% of its
                                                          configured `tokenLimit`; non-blocking
      node_skipped      {node_id, reason}             — a PASS/FAIL branch this run didn't take
      gate_retry        {node_id, attempt, cap, target} — a Gate's `fail` port looped back;
                                                          `target` is where execution resumed
      hitl_pause        {node_id, label, question, context}
      hitl_resolved     {node_id, decision, note}
      user_message      {text}                       — steering injected mid-run
      run_stopped       {at_node}
      harness_done      {status, total_tokens, tokens_estimated, elapsed_ms, nodes_run}
    """
    nodes: list[dict] = harness_json.get("nodes", [])
    edges: list[dict] = harness_json.get("edges", [])
    if not nodes and isinstance(harness_json.get("graph"), dict):
        nodes = harness_json["graph"].get("nodes", [])
        edges = harness_json["graph"].get("edges", [])
    control = control or RunControl(run_id or str(uuid.uuid4()))

    node_map = {n["id"]: n for n in nodes}
    outputs: dict[str, str] = {}
    steering: list[str] = []
    total_tokens = 0
    run_tokens_estimated = False  # any node count derived from output length
    nodes_run = 0
    harness_start = time.time()
    # PASS/FAIL-style conditional routing (`edge.data.condition`) — a branch
    # this run's decisions didn't take, not a graph error. Distinct from
    # `unreachable`: that set is a structural property of the graph, known
    # before any node runs; `skipped` can only be known as each source
    # node's real output comes in, so it accumulates during the walk below
    # rather than being computed once up front the way topological_sort's
    # unreachable set is.
    skipped: set[str] = set()

    order, unreachable, retry_edges = topological_sort(nodes, edges)
    order_index = {nid: i for i, nid in enumerate(order)}
    retry_by_gate = {e["source"]: e for e in retry_edges}
    gate_attempts: dict[str, int] = {}

    yield _sse(
        "run_start",
        {
            "run_id": control.run_id,
            "mode": execution_mode,
            "step": control.step,
            "order": [_node_view(node_map[nid]) for nid in order if nid in node_map],
            "unreachable": unreachable,
        },
    )

    bundle_runtime = harness_json.get("runtime")
    choice = select_runtime(bundle_runtime, user_pref, probe=probe)
    yield _sse(
        "runtime_selected",
        {"kind": choice.kind, "name": choice.name, "reason": choice.reason},
    )

    # A cycle (or any node unreachable from the entry point) used to still
    # report `status: "complete"` here — reproduced live and confirmed by an
    # independent research pass, 2026-09-12: `unreachable=['a','b']`,
    # `order=[]`, `nodes_run=0`, `status='complete'`. Zero nodes ran; that is
    # not success. `run_start`'s `notices` already told the person which
    # nodes are unreachable — this is what makes the *outcome* honest too,
    # not just the warning text next to it.
    status = STATUS_ERROR if unreachable else STATUS_COMPLETE
    stopped_at: str | None = None

    # A plain `for` walk can't rewind, and a bounded Gate-fail retry loop
    # needs to re-run an earlier segment of `order` at runtime (structural
    # ordering alone can't express "run this again" — see topological_sort's
    # docstring for the structural half of this fix). `pos` replaces `index`
    # everywhere below with the *same* meaning for a first, uninterrupted
    # pass — advanced immediately after each node_id is read, so every
    # existing `continue`/`break` in the body keeps behaving exactly as it
    # did against the old `for index, node_id in enumerate(order)` — and the
    # Gate-retry block further down is the only place that ever assigns `pos`
    # a value other than its own `+ 1`, rewinding it back to the retry
    # target instead of letting it advance.
    attempts_total = 0
    pos = 0
    while pos < len(order):
        node_id = order[pos]
        pos += 1
        attempts_total += 1
        node = node_map.get(node_id)
        if not node:
            continue

        if control.stop.is_set():
            status, stopped_at = STATUS_STOPPED, node_id
            break

        # Step mode parks *before* each node so a person can read the previous
        # node's output before the next one starts spending tokens.
        if control.step and attempts_total > 1:
            control.phase = "awaiting_step"
            yield _sse("awaiting_step", {"next": _node_view(node)})
            if not await control.park():
                status, stopped_at = STATUS_STOPPED, node_id
                break

        for msg in control.drain_inbox():
            steering.append(msg)
            yield _sse("user_message", {"text": msg, "at_node": node_id})

        node_type: str = node.get("type", "llm")
        data: dict = node.get("data", {})
        label = data.get("label") or node_type
        upstream_ids = [e["source"] for e in edges if e["target"] == node_id]

        # ── Conditional routing — PASS/FAIL/accept/reject edges ────────────────
        # Reproduced live and confirmed by an independent research pass,
        # 2026-09-12: the engine ran every downstream node regardless of any
        # `edge.data.condition`, so an accept/reject fork always walked both
        # branches. An edge with no `condition` is unconditional (today's
        # behaviour, unchanged). An edge *with* one is live only if its
        # source actually ran (not itself skipped) and produced output
        # containing that condition, case-insensitively — substring, not
        # exact match, because a real model's answer is rarely the bare
        # word alone ("Result: PASS." still satisfies condition "PASS").
        # A node with incoming edges where *none* are live took a branch
        # nothing selected; skip it rather than run it anyway.
        #
        # Known, deliberate limitation (not negation-aware): "ready" is a
        # substring of "not ready yet", so a condition and its own negation
        # both match — the same class of false positive a routing sentinel
        # elsewhere in this codebase hit and fixed by using a token no real
        # answer would produce (triage.py's _ENGAGE_HARNESS_TOKEN, gauntlet-
        # loop critic finding, 2026-09-11). The fix here is the same one:
        # pick distinct condition keywords (accept/reject, pass/fail), not a
        # word and its own negation — that's a harness-authoring rule, not
        # a solvable parsing problem worth adding NLP for.
        incoming_edges = [e for e in edges if e["target"] == node_id]
        if incoming_edges:
            live = False
            for e in incoming_edges:
                src = e["source"]
                if src in skipped:
                    continue
                condition = (e.get("data") or {}).get("condition")
                if not condition:
                    live = True
                    break
                if condition.strip().lower() in (outputs.get(src) or "").strip().lower():
                    live = True
                    break
            if not live:
                skipped.add(node_id)
                yield _sse("node_skipped", {"node_id": node_id, "reason": "no matching condition"})
                continue

        # ── Intrinsic nodes — resolved by the engine, no adapter ───────────────
        if node_type == "input":
            text = data.get("prompt", "")
            if steering:
                text = "\n\n".join([text, *steering]).strip()
            outputs[node_id] = text
            yield _sse("node_start", {**_node_view(node)})
            yield _sse(
                "node_done",
                {"node_id": node_id, "output": text, "tokens": 0, "latency_ms": 0},
            )
            nodes_run += 1
            continue

        if node_type == "output":
            final = "\n\n".join(
                outputs.get(uid, "") for uid in upstream_ids if outputs.get(uid)
            )
            outputs[node_id] = final
            yield _sse("node_start", {**_node_view(node)})
            yield _sse(
                "node_done",
                {"node_id": node_id, "output": final, "tokens": 0, "latency_ms": 0},
            )
            nodes_run += 1
            continue

        if node_type == "router":
            chosen_id = upstream_ids[0] if upstream_ids else None
            chosen = outputs.get(chosen_id, "") if chosen_id else ""
            outputs[node_id] = chosen
            yield _sse("node_start", {**_node_view(node)})
            yield _sse(
                "node_phase",
                {
                    "node_id": node_id,
                    "phase": "routing",
                    "detail": data.get("condition", "first upstream branch"),
                },
            )
            yield _sse(
                "node_done",
                {"node_id": node_id, "output": chosen, "tokens": 0, "latency_ms": 0},
            )
            nodes_run += 1
            continue

        if node_type == "hitl":
            context = "\n\n".join(
                outputs.get(uid, "") for uid in upstream_ids if outputs.get(uid)
            )
            yield _sse("node_start", {**_node_view(node)})
            control.phase = "awaiting_human"
            control.decision = None
            yield _sse(
                "hitl_pause",
                {
                    "node_id": node_id,
                    "label": label,
                    "question": data.get("approvalLabel")
                    or "Approve this step and continue the run?",
                    "context": context,
                },
            )
            if not await control.park():
                status, stopped_at = STATUS_STOPPED, node_id
                break

            decision = (control.decision or {}).get("decision", "approve")
            note = (control.decision or {}).get("note", "")
            yield _sse(
                "hitl_resolved",
                {"node_id": node_id, "decision": decision, "note": note},
            )
            if decision == "reject":
                outputs[node_id] = ""
                yield _sse(
                    "node_error",
                    {"node_id": node_id, "error": note or "Rejected by reviewer."},
                )
                status, stopped_at = STATUS_STOPPED, node_id
                break

            merged = context if not note else f"{context}\n\nReviewer note: {note}"
            outputs[node_id] = merged
            yield _sse(
                "node_done",
                {"node_id": node_id, "output": merged, "tokens": 0, "latency_ms": 0},
            )
            nodes_run += 1
            continue

        # ── EXPERIMENTAL — Laya decision node (ADR-0005, spike) ────────────────
        # Opt-in only: never part of compile_skills_harness.py's standard
        # Agile graph. `decisionResult` on this node's own `node_done` is
        # evidence only -- nothing in this module (conditional routing above,
        # Gate retry, HITL) ever reads it, and this block never writes to
        # anything another node's branch depends on besides `outputs[node_id]`
        # itself, which is a verbatim pass-through of its own input (same
        # shape as the `hitl`-approve path above), never a transformation.
        # Removing this node from a graph must not change any other node's
        # result -- see tests/test_engine_decision_node.py, in particular
        # test_removing_the_decision_node_does_not_change_any_other_node_result.
        #
        # Calls a separate Laya process over loopback HTTP
        # (backend/laya_loopback/server.py) -- never the provider/adapter
        # path below, never OH_SECRETS (Laya's local HF-cached weights are
        # not a provider credential). A loopback that isn't up, a busy port,
        # or a timeout is an honest node_error, same convention as
        # ProviderResolutionError elsewhere in this file -- never a fabricated
        # decisionResult.
        if node_type == "decision":
            context = "\n\n".join(
                outputs.get(uid, "") for uid in upstream_ids if outputs.get(uid)
            )
            outputs[node_id] = context
            yield _sse("node_start", {**_node_view(node)})

            port = os.environ.get("LAYA_LOOPBACK_PORT", str(_LAYA_LOOPBACK_DEFAULT_PORT))
            url = f"http://127.0.0.1:{port}/predict"
            questions = data.get("decisionQuestions") or {}
            call_start = time.time()
            try:
                async with httpx.AsyncClient(
                    timeout=_LAYA_LOOPBACK_TIMEOUT_S, transport=decision_transport
                ) as client:
                    resp = await client.post(
                        url,
                        json={"state": {"output": context}, "questions": questions},
                    )
                resp.raise_for_status()
                payload = resp.json()
            except Exception as exc:
                status = STATUS_ERROR
                yield _sse(
                    "node_error",
                    {
                        "node_id": node_id,
                        "error": f"Laya loopback unavailable at {url}: {exc}",
                    },
                )
                stopped_at = node_id
                break

            latency_ms = payload.get("latency_ms", round((time.time() - call_start) * 1000, 2))
            decision_result = {
                "schema_version": payload.get("schema_version", "oharness-decision-node-v1"),
                # Constant -- never graph-author-supplied. See ADR-0005 item 1.
                "authority": "advisory-shadow",
                "model_result": payload.get("model_result"),
                "latency_ms": latency_ms,
            }
            yield _sse(
                "node_done",
                {
                    "node_id": node_id,
                    "output": context,
                    "tokens": 0,
                    "latency_ms": latency_ms,
                    "decisionResult": decision_result,
                },
            )
            nodes_run += 1
            continue

        # ── Adapter-backed nodes ──────────────────────────────────────────────
        prompt_parts = [outputs.get(uid, "") for uid in upstream_ids if outputs.get(uid)]
        prompt = "\n\n".join(prompt_parts) or data.get("prompt", "")

        # `mock` is an explicit choice made in the composer's mode switch, not
        # a fallback — it always uses MockAdapter regardless of what the node
        # carries. Any other mode resolves a real provider connection per node
        # and never silently substitutes mock when that resolution fails
        # (docs/product/provider-harness-rule.md).
        if execution_mode == "mock":
            adapter_name = "mock"
            adapter = get_adapter(adapter_name)
            config = AdapterConfig(
                adapter=adapter_name,
                model=data.get("model", ""),
                endpoint=data.get("endpoint", ""),
                api_key="",
                system_prompt=data.get("systemPrompt", ""),
                temperature=float(data.get("temperature", 0.7)),
                max_tokens=int(data.get("maxTokens", 4096)),
                extra={"node_type": node_type, "label": label},
            )
        else:
            # ── Provider failover — AC#1 (resolution) + AC#2/#3 (runtime) ──
            #
            # `providerIds[1:]` (PROVIDER-FAILOVER story): each id is tried in
            # order. An id that fails to *resolve* (disabled connection,
            # unknown provider, missing credential —
            # `resolve_node_provider_with_failover`, AC#1) is skipped for the
            # next one with nothing ever observable — no node_start for it.
            # An id that resolves but whose adapter fails on the *very first*
            # event it ever yields (CLI missing, immediate exception — AC#2)
            # is *also* skipped for the next one, and just as invisibly: the
            # peek below happens before `node_start` is ever emitted, so a
            # connection that never truly served the turn never appears in
            # one. Once a candidate's stream has yielded even one event, this
            # loop commits to it — any later failure is `except Exception`
            # below, exactly as before this story (AC#3): no retry, no
            # duplicated or discarded partial output.
            #
            # A single-entry (or empty) `providerIds` walks this loop exactly
            # once, so its observable shape is byte-for-byte what
            # `resolve_node_provider` + a plain `try/except` around the
            # stream produced before this story existed (AC#6).
            remaining_ids = [str(p) for p in (data.get("providerIds") or []) if p]
            failover_attempts: list[FailoverAttempt] = []
            resolved = None
            stream_iter = None
            peeked_events: list[dict] = []
            resolution_error: ProviderResolutionError | None = None
            budget_error: BudgetExceededError | None = None
            runtime_error: Exception | None = None

            while True:
                # Not `while remaining_ids:` — an originally-empty/missing
                # `providerIds` must still take one pass through this loop so
                # `resolve_node_provider_with_failover` raises its honest "no
                # provider is set" error (AC#6); every `continue` below only
                # fires with a non-empty `rest`, so this can't spin forever.
                sub_data = {**data, "providerIds": remaining_ids}
                try:
                    candidate, resolve_rejects = resolve_node_provider_with_failover(
                        sub_data, node_type, label,
                        connections=connections, secrets_store=secrets_store, cwd=cwd,
                    )
                except ProviderResolutionError as exc:
                    resolution_error = exc
                    break
                failover_attempts.extend(resolve_rejects)

                # ── Global budget enforcement — per candidate, before its
                # adapter is ever invoked (SEC P2-4 re-review, 2026-09-15; see
                # the long-form rationale this replaced, git blame). A budget
                # refusal is a policy decision, not a transient fault — it is
                # deliberately never retried against the next id.
                if execution_mode != "mock" and enforce_budget is not None:
                    residence = (connections or {}).get(candidate.connection_id, {}).get("residence")
                    try:
                        await enforce_budget(candidate.config.model, residence)
                    except BudgetExceededError as exc:
                        resolved = candidate
                        budget_error = exc
                        break

                # ── Pre-flight health check — AC#2 (ARCH bounce, 2026-10-02) ──
                #
                # `probe()` never spends a token (adapters/base.py:89) and is
                # the honest way to learn a candidate is unusable (CLI
                # missing, credential invalid, etc.) *before* ever touching
                # its stream. Without this, the peek below used to be the
                # only signal -- but every real adapter's `stream_events()`
                # inherits the default in adapters/base.py that yields a
                # synthetic `{"kind": "phase", ...}` event before the adapter
                # is actually invoked, so the peek always saw that harmless
                # event first and committed to a candidate that had not yet
                # proven itself. A probe failure is treated exactly like a
                # resolution failure: never observable (no `node_start` for
                # this candidate), and the next id in the chain is tried.
                #
                # B2 (ARCH re-bounce, 2026-10-02): `rest` is computed *before*
                # deciding whether to probe at all. When there is no next
                # candidate to fall back to, a probe's result is always
                # discarded below (the real failure surfaces at the peek
                # instead, same shape as before this story -- AC#6), so
                # calling it would only pay its 10-15s timeout
                # (`claude auth status` / `GET /models`) for nothing -- and
                # that wait is not Stop-interruptible (STOP-RESPONSIVENESS
                # regression). Skip `probe()` entirely in that case.
                idx = remaining_ids.index(candidate.connection_id)
                rest = remaining_ids[idx + 1:]
                if rest:
                    # B1 (ARCH bounce, 2026-10-02): `probe()` itself can raise
                    # (e.g. `run_cli` spawning the CLI subprocess hits an
                    # `OSError`, or `NotImplementedError` on Windows' default
                    # SelectorEventLoop -- adapters/cli_shared.py:180). Left
                    # unguarded that exception propagates straight out of this
                    # generator, past the router's own SSE error handling, and
                    # the client never sees a `node_error`/`harness_done` --
                    # just a bare transport error with no failover attempted.
                    # Treat a raising probe exactly like an honest negative
                    # one, using the same `failure_details` formatting every
                    # other runtime failure in this loop already goes through.
                    try:
                        probe_result = await candidate.adapter.probe(candidate.config)
                    except Exception as exc:  # noqa: BLE001 — downgraded to ProbeResult below
                        probe_result = ProbeResult(
                            ok=False,
                            detail=failure_details(exc).get("error", "Provider probe failed."),
                        )
                    if not probe_result.ok:
                        # SEC (security-harness, 2026-10-02, F1/P3): `probe_result.detail`
                        # is free text from the CLI/SDK (raw stderr, httpx exception
                        # text) -- exactly what `outcomes.py`'s own comment warns can
                        # carry a URL, prompt or credential. Every other failover
                        # reason in this loop goes through `failure_details`'s fixed
                        # vocabulary; a probe rejection must too, never the raw detail.
                        detail = (
                            "Provider is not set up (CLI missing, not logged in, or endpoint unreachable)."
                            if probe_result.health == "setup"
                            else "Provider failed a pre-flight health check."
                        )
                        failover_attempts.append(
                            FailoverAttempt(connection_id=candidate.connection_id, reason=detail)
                        )
                        remaining_ids = rest
                        continue
                # else: no candidate left to retry -- fall through to the
                # ordinary peek below, `probe()` never invoked.

                # ── Peek, skipping the synthetic "phase" lead-in — AC#2/#3 ──
                #
                # `stream_events()`'s default implementation (adapters/base.py)
                # always yields a `{"kind": "phase", ...}` event before the
                # adapter does any real work, so the *first* event is never
                # proof the candidate actually served the turn (the probe
                # above is now that proof). This loop keeps pulling past any
                # number of leading phase events -- buffering them to replay
                # faithfully once committed -- and only commits on genuine
                # content or stops on exception/EOF, same as before.
                candidate_iter = control.stream_until_stopped(
                    candidate.adapter.stream_events(prompt, candidate.config)
                )
                phase_buffer: list[dict] = []
                try:
                    while True:
                        event = await candidate_iter.__anext__()
                        if isinstance(event, dict) and event.get("kind") == "phase":
                            phase_buffer.append(event)
                            continue
                        break
                except StopAsyncIteration:
                    resolved, stream_iter, peeked_events = candidate, candidate_iter, phase_buffer
                    break
                except Exception as exc:  # noqa: BLE001 — classified below, never re-raised raw
                    idx = remaining_ids.index(candidate.connection_id)
                    rest = remaining_ids[idx + 1:]
                    if rest:
                        failover_attempts.append(
                            FailoverAttempt(
                                connection_id=candidate.connection_id,
                                reason=failure_details(exc).get("error", "Provider execution failed."),
                            )
                        )
                        remaining_ids = rest
                        continue
                    # No candidate left to retry -- commit to this one and
                    # report the honest runtime error below, same shape as
                    # today's single-provider except-block always produced.
                    #
                    # B3 (ARCH bounce, 2026-10-02): `phase_buffer` holds any
                    # leading phase events already pulled from this
                    # candidate's stream before it failed -- without saving
                    # them into `peeked_events` here, they were silently
                    # dropped and the node emitted ['node_start', 'node_error']
                    # instead of the ['node_start', 'node_phase', 'node_error']
                    # the original (pre-story) `async for` always produced.
                    resolved = candidate
                    runtime_error = exc
                    peeked_events = phase_buffer
                    break
                else:
                    resolved, stream_iter, peeked_events = candidate, candidate_iter, phase_buffer + [event]
                    break

            if resolved is None:
                # Every remaining id failed to *resolve* -- identical to
                # today's single-id shape (AC#6), just naming the last id
                # tried when more than one was authored.
                view = _node_view(node)
                view["adapter"] = "unresolved"
                yield _sse("node_start", view)
                outputs[node_id] = ""
                status = STATUS_ERROR
                yield _sse("node_error", {"node_id": node_id, "error": str(resolution_error)})
                stopped_at = node_id
                break

            adapter_name = resolved.adapter_name
            adapter = resolved.adapter
            config = resolved.config

        node_view = _node_view(node)
        node_view["adapter"] = adapter_name
        if config.model:
            node_view["model"] = config.model
        if execution_mode != "mock":
            # The usage ledger (routers/execution.py's event_stream finally-
            # block) correlates this with the node's node_done/node_error by
            # node_id to know which connection to attribute spend to — no
            # other event ever carries it.
            node_view["connection_id"] = resolved.connection_id
            # AC#4 — explicit, distinguishable failover signal: present only
            # when at least one earlier id was tried and rejected (resolution
            # or first-event runtime failure) before this one served the
            # turn. A plain pin carries no `failover` key at all, so the two
            # are trivially distinguishable by a client or a test.
            if failover_attempts:
                node_view["failover"] = {
                    "attempts": [
                        {"connection_id": a.connection_id, "reason": a.reason}
                        for a in failover_attempts
                    ],
                }

        if execution_mode != "mock" and budget_error is not None:
            yield _sse("node_start", node_view)
            outputs[node_id] = ""
            status = STATUS_ERROR
            yield _sse("node_error", {"node_id": node_id, "error": str(budget_error)})
            stopped_at = node_id
            break

        yield _sse("node_start", node_view)
        node_start = time.time()
        collected: list[str] = []
        node_tokens = 0

        try:
            if execution_mode != "mock" and runtime_error is not None:
                # B3 (ARCH bounce, 2026-10-02): replay the leading phase
                # events the peek already pulled off this candidate's stream
                # before it failed, exactly as the `async for` below would
                # have emitted them had it reached them itself -- restoring
                # the original ['node_start', 'node_phase', 'node_error']
                # sequence (AC#6) instead of silently dropping them.
                for ev in peeked_events:
                    control.phase = ev.get("phase", "")
                    yield _sse(
                        "node_phase",
                        {
                            "node_id": node_id,
                            "phase": ev.get("phase", ""),
                            "detail": ev.get("detail", ""),
                        },
                    )
                # Exhausted every candidate at the first-event boundary --
                # re-raise straight into the `except` below so it produces
                # the exact same node_error shape a single-provider node's
                # own stream failure always has (AC#6: with one id,
                # `remaining_ids` is already empty on the very first and
                # only attempt, so this is the *only* path that id can take).
                raise runtime_error

            if execution_mode == "mock":
                stream_source = control.stream_until_stopped(adapter.stream_events(prompt, config))
            else:
                # Replays the (possibly several, possibly zero) events
                # already pulled from `stream_iter` during the peek above --
                # leading phase events plus the first genuine one, if any --
                # then resumes that very same generator where the manual
                # pull left it -- indistinguishable from a plain,
                # uninterrupted `async for` over it.
                async def _replay_peeked(first=peeked_events, rest=stream_iter):
                    for ev in first:
                        yield ev
                    if rest is not None:
                        async for ev in rest:
                            yield ev

                stream_source = _replay_peeked()

            async for ev in stream_source:
                kind = ev.get("kind")
                if kind == "phase":
                    control.phase = ev.get("phase", "")
                    yield _sse(
                        "node_phase",
                        {
                            "node_id": node_id,
                            "phase": ev.get("phase", ""),
                            "detail": ev.get("detail", ""),
                        },
                    )
                elif kind == "reason":
                    yield _sse("node_reason", {"node_id": node_id, "chunk": ev.get("text", "")})
                elif kind == "text":
                    collected.append(ev.get("text", ""))
                    yield _sse("node_stream", {"node_id": node_id, "chunk": ev.get("text", "")})
                elif kind == "tool_call":
                    yield _sse(
                        "tool_call",
                        {
                            "node_id": node_id,
                            "call_id": ev.get("call_id", ""),
                            "name": ev.get("name", ""),
                            "args": ev.get("args", ""),
                        },
                    )
                elif kind == "tool_result":
                    yield _sse(
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
            latency = int((time.time() - node_start) * 1000)

            # Adapters that never reported usage get a single cheap estimate
            # rather than the old behaviour, which reported 0 tokens for every
            # streamed node because `invoke` was only called when nothing
            # streamed at all.
            node_tokens_estimated = False
            if not node_tokens:
                node_tokens = max(1, len(output) // 4)
                node_tokens_estimated = True
                run_tokens_estimated = True
            # These tokens are real and already spent regardless of what
            # happens next (the adapter call already completed) — the run's
            # total must reflect that even when the per-node limit below
            # turns this into a node_error.
            total_tokens += node_tokens

            # ── Per-agent token limit — optional, set on the node like
            # `maxTokens`/`temperature` (PropertiesPanel's Inspector). Unlike
            # `maxTokens` (a generation-length request parameter), this is a
            # post-hoc spend check: usage is only known once the call above
            # has already completed, so there is nothing left to truncate —
            # "enforcing" the limit means marking *this node's output* as
            # failed (honest node_error, real tokens still counted above)
            # rather than silently accepting output that blew the budget.
            # Thresholds mirror the global budget's
            # (usage_tracking.WARN_THRESHOLD): non-blocking warning at 80%,
            # hard stop at/over 100%.
            token_limit = data.get("tokenLimit")
            has_limit = isinstance(token_limit, (int, float)) and token_limit > 0

            if has_limit and node_tokens >= token_limit:
                outputs[node_id] = ""
                status = STATUS_ERROR
                yield _sse(
                    "node_error",
                    {
                        "node_id": node_id,
                        "error": (
                            f"'{label}' used {node_tokens} tokens, at or over its "
                            f"configured limit of {int(token_limit)}. The turn had "
                            f"already completed and its tokens are already spent — "
                            f"this stops the node's output from being used "
                            f"downstream, not the spend itself."
                        ),
                        "tokens": node_tokens,
                    },
                )
            else:
                outputs[node_id] = output
                nodes_run += 1
                if has_limit and node_tokens >= token_limit * TOKEN_BUDGET_WARN_THRESHOLD:
                    yield _sse(
                        "node_token_warning",
                        {
                            "node_id": node_id,
                            "tokens": node_tokens,
                            "limit": int(token_limit),
                            "pct": round(node_tokens / token_limit, 4),
                        },
                    )
                node_done_data = {
                    "node_id": node_id,
                    "output": output,
                    "tokens": node_tokens,
                    "tokens_estimated": node_tokens_estimated,
                    "latency_ms": latency,
                }
                if execution_mode != "mock" and not control.stop.is_set():
                    # The frontend's provider-verification seam (useRunStream.ts)
                    # only credits a connection from this exact pair, present
                    # together on node_done itself — never inferred from
                    # node_start or composer metadata (SEC review, 2026-09-15:
                    # a node could otherwise claim a real adapter with zero
                    # actual vendor contact). A completed node here really did
                    # call `adapter.stream_events` above, so both are honest.
                    node_done_data["connection_id"] = resolved.connection_id
                    node_done_data["provider_verified"] = True
                    if failover_attempts:
                        node_done_data["failover"] = node_view["failover"]
                yield _sse("node_done", node_done_data)

                # ── Gate fail-port retry — bounded rework loop ─────────────
                # Only nodes topological_sort actually classified as closing a
                # cycle via their `fail` port get a `retry_by_gate` entry; a
                # Gate that isn't looped back to anything runs through here
                # as a no-op, unchanged from before this fix existed.
                prior_attempts = gate_attempts.get(node_id, 0)
                if node_id in retry_by_gate and _gate_decision(node, output, execution_mode, prior_attempts) == "fail":
                    attempts = gate_attempts[node_id] = prior_attempts + 1
                    cap = _gate_retry_cap(node)
                    target = retry_by_gate[node_id]["target"]
                    if attempts > cap:
                        status = STATUS_ERROR
                        stopped_at = node_id
                        target_label = (node_map.get(target, {}).get("data") or {}).get("label", target)
                        yield _sse(
                            "node_error",
                            {
                                "node_id": node_id,
                                "error": (
                                    f"'{label}' did not pass after {cap} attempt(s) looping "
                                    f"back to '{target_label}' — giving up rather than "
                                    "retrying forever."
                                ),
                            },
                        )
                        break
                    yield _sse(
                        "gate_retry",
                        {"node_id": node_id, "attempt": attempts, "cap": cap, "target": target},
                    )
                    pos = order_index[target]
                    continue

        except Exception as exc:  # noqa: BLE001 — surfaced to the client verbatim
            outputs[node_id] = ""
            status = STATUS_ERROR
            total_tokens += node_tokens
            yield _sse("node_error", {
                "node_id": node_id, "tokens": node_tokens,
                "connection_id": node_view.get("connection_id"), **failure_details(exc),
            })

        if control.stop.is_set():
            status, stopped_at = STATUS_STOPPED, node_id
            break

    if status == STATUS_STOPPED:
        yield _sse("run_stopped", {"at_node": stopped_at})

    control.phase = "done"
    elapsed = int((time.time() - harness_start) * 1000)
    yield _sse(
        "harness_done",
        {
            "status": status,
            "total_tokens": total_tokens,
            "tokens_estimated": run_tokens_estimated,
            "elapsed_ms": elapsed,
            "nodes_run": nodes_run,
        },
    )
