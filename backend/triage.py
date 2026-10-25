"""
Chat-vs-task routing — one call, at the door, before the full Agile harness
graph (PO -> SM -> BE/FE -> QA -> ARCH -> TW/SEC -> HITL) ever starts.

Why this exists: routing every message through all nine roles is right for
real work — planning, code, review, a security pass, a merge decision — and
badly wrong for "olá" (surfaced live, 2026-09-11: a bare greeting produced
nine near-identical "how can I help?" replies and then blocked on a HITL
approval for nothing). Not every question and answer needs a human in the
loop.

Design, after comparing three real implementations of the same problem
(gauntlet-loop, 2026-09-11) rather than guessing at one:

  * OpenAI Swarm's `examples/triage_agent` — a Triage Agent whose only job is
    "Determine which agent is best suited to handle the user's request, and
    transfer the conversation to that agent", exposed as tool functions
    (`transfer_to_sales()`, `transfer_to_refunds()`) that just return the
    target Agent. The routing decision and the tool-call happen in the SAME
    model turn that read the message.
  * LangGraph's `langgraph-supervisor` — the same shape at production scale:
    a supervisor gets one auto-generated `transfer_to_<agent>` tool per
    destination, and its own tool-calling decides where control goes.
  * This session's own skill-triggering mechanism (`using-superpowers`) —
    a different axis worth keeping: the *criteria* for each destination are
    plain-language scope descriptions judged inline by the model that's
    already reading the message, not a separate rubric.

None of our CLI-backed adapters (claude/codex) expose real function-calling
the way a raw OpenAI-style client does — `--tools ""` / the read-only sandbox
deliberately strip tool use for a *chat* connection (see cli_claude.py /
cli_codex.py). What carries over from the references instead: **one call
that either routes to the crew or already IS the answer**, not a separate
classifier call followed by a second call to actually reply. A sentinel
token stands in for the tool-call; everything else — a direct answer — is
used verbatim as the reply, so the direct-answer path costs exactly one
adapter call instead of two.

Naming: this module deliberately never says "handoff" for the sentinel or
the result — that word already means something specific and different in
this workspace (a summary document saved under the repo's `handoffs/`
directory so another agent can continue work in a clean context after a
session crosses the 40% Smart Zone limit). Calling this the same thing read
as confusing
(flagged live, 2026-09-11) even though the underlying *idea* — control
passing from one place to another — is the same one Swarm and LangGraph also
call "handoff" in their own docs. Here it's "route to the crew" / "engage".

Placement: this has to live in the app (`backend/`), not in the workspace's
`skills-framework` — that framework is Claude Code tooling for *developing*
this repo, and the shipped desktop app (Tauri + FastAPI sidecar) cannot
depend on a Claude Code skill system at runtime on an end user's machine.

Voice: the direct-answer path speaks as Nilo, the product's own mascot —
`SOUL.md` (repo root) is her voice, never the harness crew's. She is the
front door only: she answers what she can herself or sends a real work
request to whichever harness is loaded in this chat (today: skills-framework
Agile) or to the provider's own native way of working — she is never one of
PO/SM/BE/FE/QA/ARCH/TW/SEC, and this prompt never asks her to be.

Every failure mode (no provider resolvable, the call itself errors, an
unreadable answer) routes to the full harness — under-triggering it only
costs some tokens and an HITL click; over-triggering it (skipping real work
because this call had a bad day) would silently drop something that needed
the real gates. Same honest-error principle as `providers/resolution.py`.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from functools import lru_cache
import os
import math
from pathlib import Path
from time import perf_counter
from typing import Awaitable, Callable

import httpx

from adapters.base import AdapterConfig
from providers.resolution import ProviderResolutionError, resolve_node_provider

_SOUL_PATH = Path(__file__).resolve().parent.parent / "SOUL.md"

_ENGAGE_HARNESS_TOKEN = "<<ENGAGE_HARNESS>>"
_LAYA_LOOPBACK_DEFAULT_PORT = 8761
_LAYA_TIMEOUT_S = 0.75
_LAYA_CONFIDENCE_THRESHOLD = 0.80
_LAYA_SCHEMA_VERSION = "oharness-decision-node-v1"

_INTAKE_PROMPT = f"""If this message asks the crew to build, plan, investigate, fix, review, or change something, reply with these exact characters and nothing else, no punctuation, no explanation:
{_ENGAGE_HARNESS_TOKEN}

Otherwise — a greeting, small talk, a question you can just answer, or something you already know how to answer — answer it directly, right now, as yourself. Never write {_ENGAGE_HARNESS_TOKEN} as part of a real answer.

Message:
{{instruction}}"""

_DIRECT_REPLY_PROMPT = """Answer the message directly and completely as yourself. Do not route it, delegate it, or mention internal routing.

Message:
{instruction}"""


@dataclass(frozen=True, slots=True)
class LayaRouteDecision:
    engage_harness: bool
    confidence: float
    latency_ms: float


LayaDecideFn = Callable[[str], Awaitable[LayaRouteDecision]]


def _laya_loopback_url() -> str:
    """Build a loopback-only URL without letting an env var change the host."""
    raw_port = os.environ.get("LAYA_LOOPBACK_PORT", str(_LAYA_LOOPBACK_DEFAULT_PORT))
    try:
        port = int(raw_port, 10)
    except ValueError as exc:
        raise ValueError("LAYA_LOOPBACK_PORT must be an integer") from exc
    if not 1 <= port <= 65535:
        raise ValueError("LAYA_LOOPBACK_PORT must be between 1 and 65535")
    return f"http://127.0.0.1:{port}/predict"


def _parse_laya_decision(payload: object, observed_latency_ms: float) -> LayaRouteDecision:
    """Validate the versioned local protocol before trusting its decision."""
    if not isinstance(payload, dict) or payload.get("schema_version") != _LAYA_SCHEMA_VERSION:
        raise ValueError("unsupported Laya routing schema")
    try:
        probability = float(payload["model_result"]["answers"]["engage_harness"]["noul"])
        latency_ms = float(payload.get("latency_ms", observed_latency_ms))
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("invalid Laya routing response") from exc
    if not math.isfinite(probability) or not 0.0 <= probability <= 1.0:
        raise ValueError("Laya routing probability must be between 0 and 1")
    if not math.isfinite(latency_ms) or latency_ms < 0:
        raise ValueError("Laya routing latency must be finite and non-negative")
    return LayaRouteDecision(
        engage_harness=probability >= 0.5,
        confidence=max(probability, 1.0 - probability),
        latency_ms=latency_ms,
    )

async def decide_with_laya(instruction: str) -> LayaRouteDecision:
    """Ask the local Laya loopback for an advisory routing prediction.

    The caller owns fallback policy. This function only validates the stable
    ``noul`` response contract already used by ADR-0005's loopback.
    """
    url = _laya_loopback_url()
    questions = {
        "engage_harness": {
            "type": "noul",
            "instructions": (
                "Does this message ask agents to build, plan, investigate, fix, "
                "review, use tools, or change something rather than just answer directly?"
            ),
        }
    }
    started = perf_counter()
    async with httpx.AsyncClient(timeout=_LAYA_TIMEOUT_S) as client:
        response = await client.post(
            url,
            json={"state": {"instruction": instruction}, "questions": questions},
        )
    response.raise_for_status()
    return _parse_laya_decision(response.json(), (perf_counter() - started) * 1000)


@lru_cache(maxsize=1)
def _soul() -> str:
    """Nilo's voice, read once per process. Missing SOUL.md is not fatal —
    the intake call still works, just without her voice layered on; that
    degrades gracefully rather than breaking routing over a missing file."""
    try:
        return _SOUL_PATH.read_text(encoding="utf-8")
    except OSError:
        return ""


def _workspace_context(cwd: str | None) -> str:
    """One factual sentence naming the chat's chosen working folder.

    The composer's WorkspacePicker already threads a chosen Cowork project's
    `rootPath` this far as `cwd` (see `providers/resolution.py`'s
    `resolve_node_provider`, which validated it before it ever reached
    here) — but until this, nothing turned that path into text the model
    itself reads: `OpenAICompatibleAdapter.invoke()` (Ollama/OpenAI/
    OpenRouter) never looks at `AdapterConfig.extra` at all, and a CLI
    adapter only uses `extra["cwd"]` as the *subprocess's* working
    directory, never as something mentioned in the prompt. Real bug,
    reported 2026-09-17: the composer chip showed "Development" selected,
    and "em que folder estamos agora?" still got "Não tenho visibilidade do
    diretório de trabalho daqui" — an honest answer to what the model had
    actually been sent (nothing), but a misleading one given what the UI
    told the person was already known.

    SOUL.md is what lets Nilo explain *why* she still can't act inside this
    folder (chat is deliberately tool-free — see this module's own docstring
    and `cli_claude.py`'s); this function only supplies the one variable
    fact, the folder's own name, so that gets stated correctly instead of
    invented or omitted. Empty when no folder is chosen, so she never
    invents one — same graceful-degradation shape as `_soul()` itself."""
    if not cwd:
        return ""
    name = Path(cwd).name or cwd
    return f'This chat\'s working folder is "{name}" ({cwd}).'


@dataclass(frozen=True, slots=True)
class RouteResult:
    """`engage_harness=True` means: run the full harness graph as drawn,
    unchanged. `engage_harness=False` means: `reply` is already the
    complete, final answer, in Nilo's voice — nothing else needs to run.

    `adapter_name`/`tokens`/`connection_id`/`model` describe the one real
    adapter call `route_message` makes to decide, and are populated
    whenever that call actually completed and returned a result —
    regardless of which way `engage_harness` ends up (SEC P3-2: this call's
    spend is real either way, so the caller must be able to record it even
    when routing decides to hand off to the harness instead of using the
    reply directly). They stay at these all-zero/empty defaults only when
    no call was ever made at all — no provider pinned, connection
    resolution failed, or `invoke` itself raised rather than returning a
    result to carry them from."""

    engage_harness: bool
    reply: str = ""
    adapter_name: str = ""
    tokens: int = 0
    connection_id: str = ""
    model: str = ""
    # Wall time of that one adapter call, in ms. 0 only when no call was made
    # ("not measured") — a call that ran is never reported as 0.
    latency_ms: int = 0
    # True only when `tokens` was derived from the reply's length because the
    # provider reported no usage; False for a provider-reported count (and
    # for the zero-call defaults, which carry no tokens at all).
    tokens_estimated: bool = False
    decision_source: str = "model"
    decision_reason: str = "laya_not_requested"
    decision_confidence: float | None = None
    decision_latency_ms: float | None = None


async def route_message(
    instruction: str,
    provider_ids: list[str],
    *,
    connections: dict[str, dict] | None,
    secrets_store: object | None,
    cwd: str | None = None,
    enforce_budget: Callable[[str | None, str | None], Awaitable[None]] | None = None,
    laya_decide: LayaDecideFn | None = None,
    laya_confidence_threshold: float = _LAYA_CONFIDENCE_THRESHOLD,
) -> RouteResult:
    """Best-effort routing. Never raises for a *routing* failure — any
    problem deciding or resolving means "run the real harness", not "guess
    and maybe skip real work". `enforce_budget` is the one deliberate
    exception (SEC P2-5, 2026-09-15): it is called exactly like
    `engine.py`'s node-loop callback of the same name, once resolution
    succeeds and before the one real adapter call this function makes, and
    its `BudgetExceededError` is allowed to propagate rather than being
    swallowed into "fall back to the harness" — the harness would spend
    *more*, not less, so silently proceeding here would defeat the ceiling
    this callback exists to enforce, not just miss one node's worth of it."""
    if not instruction.strip() or not provider_ids:
        return RouteResult(engage_harness=True)

    laya_decision: LayaRouteDecision | None = None
    decision_source = "model"
    decision_reason = "laya_not_requested"
    if laya_decide is not None:
        try:
            laya_decision = await laya_decide(instruction)
        except Exception:  # noqa: BLE001 — model fallback is the designed cascade
            decision_source = "model_fallback"
            decision_reason = "unavailable"
        else:
            if laya_decision.confidence >= laya_confidence_threshold:
                if laya_decision.engage_harness:
                    return RouteResult(
                        engage_harness=True,
                        decision_source="laya",
                        decision_reason="confident",
                        decision_confidence=laya_decision.confidence,
                        decision_latency_ms=laya_decision.latency_ms,
                    )
                decision_source = "laya"
                decision_reason = "confident"
            else:
                decision_source = "model_fallback"
                decision_reason = "low_confidence"

    try:
        resolved = resolve_node_provider(
            {"providerIds": provider_ids},
            "agent",
            "Nilo",
            connections=connections,
            secrets_store=secrets_store,
            # Already validated against cowork_projects by the caller
            # (routers/execution.py) before it ever reaches here — this
            # call never sees a raw, unvalidated path. See
            # cli_shared.resolve_cwd's docstring for why that matters: an
            # adapter only trusts extra["cwd"] when extra["cwd_root"] (the
            # same validated value) is also present.
            cwd=cwd,
        )
    except ProviderResolutionError:
        # The real first node is about to hit this exact error and report it
        # honestly — let it, rather than swallowing it here first.
        return RouteResult(
            engage_harness=True,
            decision_source="model_fallback" if laya_decision else decision_source,
            decision_reason="provider_unavailable" if laya_decision else decision_reason,
            decision_confidence=laya_decision.confidence if laya_decision else None,
            decision_latency_ms=laya_decision.latency_ms if laya_decision else None,
        )

    if enforce_budget is not None:
        residence = (connections or {}).get(resolved.connection_id, {}).get("residence")
        await enforce_budget(resolved.config.model, residence)

    call_started = time.perf_counter()
    try:
        prompt = (
            _DIRECT_REPLY_PROMPT if decision_source == "laya" else _INTAKE_PROMPT
        ).format(instruction=instruction)
        result = await resolved.adapter.invoke(
            prompt,
            AdapterConfig(
                adapter=resolved.config.adapter,
                model=resolved.config.model,
                endpoint=resolved.config.endpoint,
                api_key=resolved.config.api_key,
                # Nilo's voice layers on top of (never replaces) a node-level
                # system_prompt a person may have set — hers goes first, so
                # a more specific instruction downstream still wins on
                # conflict, the same precedence order config assembly
                # already uses elsewhere in this codebase. The workspace
                # fact (if any) sits between the two: always true regardless
                # of what a node overrides, but not part of her fixed voice
                # (it changes per chat). Empty parts drop out, so this is
                # exactly `_soul()` alone when there's no cwd and no node
                # override — unchanged from before this fact existed.
                system_prompt="\n\n".join(
                    part
                    for part in (_soul(), _workspace_context(cwd), resolved.config.system_prompt)
                    if part
                ),
                temperature=resolved.config.temperature,
                max_tokens=resolved.config.max_tokens,
                extra=resolved.config.extra,
            ),
        )
    except Exception:  # noqa: BLE001 — routing must never crash the real request
        return RouteResult(
            engage_harness=True,
            decision_source="model_fallback" if laya_decision else decision_source,
            decision_reason="provider_unavailable" if laya_decision else decision_reason,
            decision_confidence=laya_decision.confidence if laya_decision else None,
            decision_latency_ms=laya_decision.latency_ms if laya_decision else None,
        )
    latency_ms = max(1, round((time.perf_counter() - call_started) * 1000))

    # Real spend already happened the moment `invoke` above returned
    # normally, regardless of what it decided — an error string on an
    # otherwise-completed call (e.g. a content-filter stop) still billed
    # real tokens. Carrying it on every `engage_harness=True` return past
    # this point (not just the `engage_harness=False` reply path) is what
    # lets the caller record it either way instead of silently dropping it
    # (SEC P3-2). The two branches *before* this call ever runs — no
    # provider pinned, or resolution failed — have no result to carry
    # tokens from, so they correctly stay at the dataclass's all-zero
    # defaults; likewise `invoke` itself raising, just above, never
    # produced a `result` to salvage anything from either.
    if result.error:
        return RouteResult(
            engage_harness=True,
            adapter_name=resolved.adapter_name,
            tokens=result.tokens_used,
            connection_id=resolved.connection_id,
            model=resolved.config.model,
            latency_ms=latency_ms,
            decision_source="model_fallback" if laya_decision else decision_source,
            decision_reason="provider_unavailable" if laya_decision else decision_reason,
            decision_confidence=laya_decision.confidence if laya_decision else None,
            decision_latency_ms=laya_decision.latency_ms if laya_decision else None,
        )

    text = result.content.strip()
    # Exact match, not a prefix check (gauntlet-loop critic, 2026-09-11): a
    # `startswith("HANDOFF:")` check collided with any genuine answer that
    # happened to open with that word (e.g. "What's a handoff in agile?").
    # This token is not natural language — a real answer is never exactly
    # and only these characters with nothing else.
    if not text or text == _ENGAGE_HARNESS_TOKEN:
        return RouteResult(
            engage_harness=True,
            adapter_name=resolved.adapter_name,
            tokens=result.tokens_used,
            connection_id=resolved.connection_id,
            model=resolved.config.model,
            latency_ms=latency_ms,
            decision_source=decision_source,
            decision_reason=decision_reason,
            decision_confidence=laya_decision.confidence if laya_decision else None,
            decision_latency_ms=laya_decision.latency_ms if laya_decision else None,
        )

    return RouteResult(
        engage_harness=False,
        reply=text,
        adapter_name=resolved.adapter_name,
        tokens=result.tokens_used or max(1, len(text) // 4),
        connection_id=resolved.connection_id,
        model=resolved.config.model,
        latency_ms=latency_ms,
        tokens_estimated=not result.tokens_used,
        decision_source=decision_source,
        decision_reason=decision_reason,
        decision_confidence=laya_decision.confidence if laya_decision else None,
        decision_latency_ms=laya_decision.latency_ms if laya_decision else None,
    )
