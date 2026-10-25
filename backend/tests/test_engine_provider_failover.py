"""
Story PROVIDER-FAILOVER — engine.py's runtime side (AC#2, AC#3, AC#4, AC#6).

AC#1 (a `providerIds` entry that fails to *resolve* — disabled connection,
unknown id, missing credential) is covered directly against
`providers.resolution.resolve_node_provider_with_failover` in
`test_provider_resolution.py`; these tests are about what happens once an
entry *does* resolve but the adapter itself misbehaves at runtime, which only
`engine.py`'s node loop can observe (it is the one thing here that actually
calls `adapter.stream_events`/`adapter.probe`).

Two connections, two different provider ids (`anthropic` -> `claude` adapter,
`openrouter` -> `openrouter` adapter) so `get_adapter()` can be monkeypatched
to hand back a *different* stub per connection — the whole point of these
tests is telling A's adapter apart from B's.

ARCH bounce (2026-10-02): the previous version of this file's AC#2 fakes
overrode `stream_events()` wholesale, which skipped the synthetic
`{"kind": "phase", ...}` event every *real* adapter's `stream_events()`
emits before touching the provider (the default implementation in
`adapters/base.py`). The engine's old "peek the first event to decide
whether to commit" logic always saw that harmless phase event and committed
immediately — a CLI-not-found failure only ever surfaced *after* `node_start`
had already been emitted, so AC#2's actual promise (fail over before
anything is observable) was never exercised by a fake that short-circuited
past the one event that triggered the bug. The fakes below now inherit the
real default `stream_events()` (only `probe()`/`stream()` are overridden),
so the phase event is genuinely emitted, exactly like every concrete adapter
(`cli_claude.py`, `cli_codex.py`, `cli_cursor.py`, `openai_compatible.py`).
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator


from adapters.base import AdapterConfig, AgentAdapter, AdapterResult, ProbeResult
from engine import RunControl, execute_harness
from secret_store.memory import MemorySecrets


class _ProbeFailsAdapter(AgentAdapter):
    """Fails its pre-flight `probe()` -- exactly how a real adapter reports
    a missing CLI (`cli_claude.py:147-154`: `find_cli` comes back empty ->
    `ProbeResult(ok=False, health="setup", ...)`).

    Deliberately does NOT override `stream_events()`: it inherits the real
    default (`adapters/base.py`) that emits a synthetic `{"kind": "phase"}`
    event before ever touching `stream()` -- and `stream()` here *succeeds*
    if it is ever reached. That is the point: if the engine only relied on
    peeking the stream (the pre-bounce behaviour), it would see the harmless
    phase event, then genuine content, and wrongly commit to this candidate
    despite its probe screaming "unusable". Only an engine that actually
    calls and honors `probe()` skips this candidate before any of that --
    proving the pre-flight check itself, not the stream, causes the skip.
    """

    def __init__(self) -> None:
        self.probed: list[AdapterConfig] = []
        self.calls: list[AdapterConfig] = []

    async def probe(self, config: AdapterConfig) -> ProbeResult:
        self.probed.append(config)
        return ProbeResult(ok=False, health="setup", detail="claude CLI not found on PATH (test).")

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        raise AssertionError("invoke() should never be called by the engine")

    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        self.calls.append(config)
        yield "should never reach the person -- probe already rejected this candidate"


class _ProbePassesButFirstRealAttemptFailsAdapter(AgentAdapter):
    """Passes pre-flight (`probe()` -> ok) but the adapter's real first
    attempt still fails right after the synthetic phase event -- the rare
    case `probe()` cannot catch (AC#2's second line of defence: a candidate
    only discovered broken on the actual call, e.g. a pinned model the
    provider rejects).

    Also does NOT override `stream_events()`, so the phase event is
    genuinely emitted by the real default before `stream()` raises --
    reproducing the exact event shape a real adapter produces.
    """

    def __init__(self) -> None:
        self.probed: list[AdapterConfig] = []
        self.calls: list[AdapterConfig] = []

    async def probe(self, config: AdapterConfig) -> ProbeResult:
        self.probed.append(config)
        return ProbeResult(ok=True, health="live")

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        raise AssertionError("invoke() should never be called by the engine")

    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        self.calls.append(config)
        raise RuntimeError("claude CLI binary not found")
        yield  # pragma: no cover — makes this an async generator, never reached


class _ProbeRaisesAdapter(AgentAdapter):
    """`probe()` itself raises -- B1 (ARCH bounce, 2026-10-02): `run_cli`
    spawning the CLI subprocess can hit an `OSError`, or `NotImplementedError`
    under Windows' default SelectorEventLoop (`adapters/cli_shared.py:180`).
    Before the fix this propagated straight out of the engine's generator,
    past the router's own SSE error handling, with no `node_error` and no
    failover attempted at all -- a regression from the plain `node_error`
    the same failure produced before this story. A correct engine must treat
    this exactly like an honest negative probe result and retry the next id.

    `stream()` would succeed if ever reached, same as `_ProbeFailsAdapter`,
    to prove the *probe exception* -- not a stream failure -- causes the skip.
    """

    def __init__(self) -> None:
        self.probed: list[AdapterConfig] = []
        self.calls: list[AdapterConfig] = []

    async def probe(self, config: AdapterConfig) -> ProbeResult:
        self.probed.append(config)
        raise OSError("failed to spawn claude CLI subprocess (test)")

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        raise AssertionError("invoke() should never be called by the engine")

    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        self.calls.append(config)
        yield "should never reach the person -- probe already rejected this candidate"


class _ProbeMustNotBeCalledAdapter(AgentAdapter):
    """B2 (ARCH re-bounce, 2026-10-02): the *only* candidate in `providerIds`
    has no `rest` to fall back to, so its probe result would always be
    discarded -- the engine must skip calling `probe()` altogether rather
    than paying its 10-15s timeout for nothing. `probe()` raises an
    `AssertionError` if the engine ever calls it, proving the skip."""

    def __init__(self) -> None:
        self.calls: list[AdapterConfig] = []

    async def probe(self, config: AdapterConfig) -> ProbeResult:
        raise AssertionError("probe() must never be called for the last/only candidate")

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        raise AssertionError("invoke() should never be called by the engine")

    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        self.calls.append(config)
        yield "the honest, only output"


class _FailsAfterOneChunkAdapter(AgentAdapter):
    """Passes pre-flight, delivers one real content event, *then* dies --
    AC#3's exact shape. Inherits the real default `stream_events()`, so the
    synthetic phase event precedes the real "partial answer" text event,
    exactly like a real adapter -- and AC#3 is unaffected by that: the
    engine only ever needs to see *one* genuine content event to commit,
    phase events never count towards that.
    """

    def __init__(self) -> None:
        self.calls: list[AdapterConfig] = []

    async def probe(self, config: AdapterConfig) -> ProbeResult:
        return ProbeResult(ok=True, health="live")

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        raise AssertionError("invoke() should never be called by the engine")

    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        self.calls.append(config)
        yield "partial answer"
        raise ConnectionError("connection reset mid-turn")


class _WorksAdapter(AgentAdapter):
    """Ordinary, successful adapter — stands in for the fallback connection."""

    def __init__(self) -> None:
        self.calls: list[AdapterConfig] = []

    async def probe(self, config: AdapterConfig) -> ProbeResult:
        return ProbeResult(ok=True, health="live")

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        self.calls.append(config)
        return AdapterResult(content="fallback output", tokens_used=5)

    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        self.calls.append(config)
        yield "fallback output"

    async def stream_events(self, prompt: str, config: AdapterConfig):
        self.calls.append(config)
        yield {"kind": "text", "text": "fallback output"}
        yield {"kind": "usage", "tokens": 5}


def _events(chunks: list[str]) -> list[tuple[str, dict]]:
    out = []
    for c in chunks:
        if not c.startswith("event: "):
            continue
        name, _, rest = c.partition("\n")
        name = name.removeprefix("event: ").strip()
        data_line = rest.strip().removeprefix("data: ")
        out.append((name, json.loads(data_line)))
    return out


def _connections() -> dict[str, dict]:
    return {
        "anthropic": {
            "id": "anthropic",
            "provider": "anthropic",
            "label": "Anthropic",
            "residence": "cloud",
            "endpoint": "https://api.anthropic.com",
            "enabled": True,
            "secretRef": None,
        },
        "openrouter": {
            "id": "openrouter",
            "provider": "openrouter",
            "label": "OpenRouter",
            "residence": "cloud",
            "endpoint": "https://openrouter.ai/api/v1",
            "enabled": True,
            "secretRef": "oharness/openrouter",
            "defaultModel": "anthropic/claude-opus-5",
        },
    }


def _one_llm_node_graph(node_data: dict) -> dict:
    return {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi"}},
            {"id": "draft", "type": "llm", "data": {"label": "Draft", **node_data}},
        ],
        "edges": [{"source": "in", "target": "draft"}],
    }


def _run(graph: dict, connections: dict, secrets_store, adapters_by_name: dict, monkeypatch):
    monkeypatch.setattr(
        "providers.resolution.get_adapter", lambda name: adapters_by_name[name]
    )

    async def collect() -> list[str]:
        control = RunControl("t")
        chunks = []
        async for chunk in execute_harness(
            graph,
            execution_mode="live",
            control=control,
            connections=connections,
            secrets_store=secrets_store,
        ):
            chunks.append(chunk)
        return chunks

    return _events(asyncio.run(collect()))


def _store() -> MemorySecrets:
    store = MemorySecrets()
    store.put("oharness/openrouter", "sk-or-REAL")
    return store


# ── AC#2 — retry before any content reaches the person ─────────────────────


def test_ac2_probe_rejection_retries_next_provider_before_any_content(monkeypatch) -> None:
    """Layer 1: a candidate whose `probe()` reports unusable is skipped
    before `node_start`, even though its `stream()` would have succeeded if
    ever reached -- proving the pre-flight check itself causes the skip,
    not a stream failure the old peek-only logic would have caught anyway."""
    graph = _one_llm_node_graph({"providerIds": ["anthropic", "openrouter"]})
    claude, openrouter = _ProbeFailsAdapter(), _WorksAdapter()

    events = _run(
        graph, _connections(), _store(),
        {"claude": claude, "openrouter": openrouter}, monkeypatch,
    )

    assert len(claude.probed) == 1  # probe really was consulted
    assert claude.calls == [], "a rejected probe must stop the adapter from ever streaming"
    assert len(openrouter.calls) == 1  # and the fallback really ran

    node_starts = [d for n, d in events if n == "node_start" and d["node_id"] == "draft"]
    assert len(node_starts) == 1, "must never emit a node_start for the failed connection"
    assert node_starts[0]["connection_id"] == "openrouter"

    assert not any(n == "node_error" for n, _ in events)
    node_done = next(d for n, d in events if n == "node_done" and d["node_id"] == "draft")
    assert node_done["output"] == "fallback output"
    assert node_done["connection_id"] == "openrouter"

    # SEC (security-harness, 2026-10-02, F1/P3): a probe rejection's `reason`
    # must be the fixed, safe vocabulary -- never the adapter's raw detail
    # (CLI stderr, httpx exception text), which can carry a URL, prompt or
    # credential (outcomes.py's own warning).
    reason = node_done["failover"]["attempts"][0]["reason"]
    assert reason == "Provider is not set up (CLI missing, not logged in, or endpoint unreachable)."
    assert "claude CLI not found on PATH" not in reason

    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "complete"


def test_ac2_probe_passes_but_first_real_attempt_fails_retries_next_provider(monkeypatch) -> None:
    """Layer 2 (safety net): a candidate that *passes* `probe()` but still
    fails on its genuine first attempt -- right after the synthetic phase
    event -- is also skipped invisibly. This is the case `probe()` alone
    cannot catch, covered independently of Layer 1."""
    graph = _one_llm_node_graph({"providerIds": ["anthropic", "openrouter"]})
    claude, openrouter = _ProbePassesButFirstRealAttemptFailsAdapter(), _WorksAdapter()

    events = _run(
        graph, _connections(), _store(),
        {"claude": claude, "openrouter": openrouter}, monkeypatch,
    )

    assert len(claude.probed) == 1
    assert len(claude.calls) == 1  # it really was tried, and really failed
    assert len(openrouter.calls) == 1  # and the fallback really ran

    node_starts = [d for n, d in events if n == "node_start" and d["node_id"] == "draft"]
    assert len(node_starts) == 1, "must never emit a node_start for the failed connection"
    assert node_starts[0]["connection_id"] == "openrouter"
    attempts = node_starts[0]["failover"]["attempts"]
    assert [a["connection_id"] for a in attempts] == ["anthropic"]
    assert attempts[0]["reason"]

    assert not any(n == "node_error" for n, _ in events)
    node_done = next(d for n, d in events if n == "node_done" and d["node_id"] == "draft")
    assert node_done["output"] == "fallback output"
    assert node_done["connection_id"] == "openrouter"

    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "complete"


# ── B1 — a probe that raises must never kill the run ───────────────────────


def test_b1_probe_raising_exception_retries_next_provider_not_a_dead_run(monkeypatch) -> None:
    """A `probe()` that raises (e.g. a subprocess spawn `OSError`) must be
    treated exactly like an honest negative probe result -- failover to the
    next id -- never an unhandled exception escaping the engine's generator
    (which would skip `node_error`/`harness_done` entirely)."""
    graph = _one_llm_node_graph({"providerIds": ["anthropic", "openrouter"]})
    claude, openrouter = _ProbeRaisesAdapter(), _WorksAdapter()

    events = _run(
        graph, _connections(), _store(),
        {"claude": claude, "openrouter": openrouter}, monkeypatch,
    )

    assert len(claude.probed) == 1  # probe really was consulted, and really raised
    assert claude.calls == [], "a raising probe must stop the adapter from ever streaming"
    assert len(openrouter.calls) == 1  # and the fallback really ran

    node_starts = [d for n, d in events if n == "node_start" and d["node_id"] == "draft"]
    assert len(node_starts) == 1, "must never emit a node_start for the failed connection"
    assert node_starts[0]["connection_id"] == "openrouter"
    attempts = node_starts[0]["failover"]["attempts"]
    assert [a["connection_id"] for a in attempts] == ["anthropic"]
    assert attempts[0]["reason"]  # non-empty, human-readable -- not a stack trace

    assert not any(n == "node_error" for n, _ in events), (
        "a probe exception must never surface as an unhandled/transport error"
    )
    node_done = next(d for n, d in events if n == "node_done" and d["node_id"] == "draft")
    assert node_done["output"] == "fallback output"

    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "complete"


# ── B2 — probe() is never called when there is no candidate left to retry ──


def test_b2_single_provider_id_never_calls_probe(monkeypatch) -> None:
    """With a single `providerIds` entry, `rest` is always empty -- any
    probe result would be discarded, so the engine must skip `probe()`
    entirely rather than pay its 10-15s timeout for nothing (and that wait
    is not Stop-interruptible -- a STOP-RESPONSIVENESS regression)."""
    graph = _one_llm_node_graph({"providerIds": ["anthropic"]})
    claude = _ProbeMustNotBeCalledAdapter()

    events = _run(graph, _connections(), _store(), {"claude": claude}, monkeypatch)

    assert len(claude.calls) == 1  # the stream really ran -- probe() was simply skipped

    node_done = next(d for n, d in events if n == "node_done" and d["node_id"] == "draft")
    assert node_done["output"] == "the honest, only output"
    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "complete"


# ── AC#3 — a later failure (content already delivered) is never retried ────


def test_ac3_failure_after_real_content_is_never_retried_no_duplication(monkeypatch) -> None:
    graph = _one_llm_node_graph({"providerIds": ["anthropic", "openrouter"]})
    claude, openrouter = _FailsAfterOneChunkAdapter(), _WorksAdapter()

    events = _run(
        graph, _connections(), _store(),
        {"claude": claude, "openrouter": openrouter}, monkeypatch,
    )

    assert len(claude.calls) == 1
    assert openrouter.calls == [], "the fallback must never be consulted once content streamed"

    node_start = next(d for n, d in events if n == "node_start" and d["node_id"] == "draft")
    assert node_start["connection_id"] == "anthropic"

    stream_chunks = [d for n, d in events if n == "node_stream" and d["node_id"] == "draft"]
    assert stream_chunks == [{"node_id": "draft", "chunk": "partial answer"}]  # exactly once

    node_error = next(d for n, d in events if n == "node_error" and d["node_id"] == "draft")
    assert node_error["connection_id"] == "anthropic"

    assert not any(n == "node_done" and d["node_id"] == "draft" for n, d in events)
    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "error"


# ── AC#4 — the failover signal is explicit and distinguishable from a pin ──


def test_ac4_failover_signal_present_and_distinguishable_from_plain_pin(monkeypatch) -> None:
    graph = _one_llm_node_graph({"providerIds": ["anthropic", "openrouter"]})
    claude, openrouter = _ProbeFailsAdapter(), _WorksAdapter()

    events = _run(
        graph, _connections(), _store(),
        {"claude": claude, "openrouter": openrouter}, monkeypatch,
    )

    node_start = next(d for n, d in events if n == "node_start" and d["node_id"] == "draft")
    assert "failover" in node_start, "must carry a distinct signal, not just connection_id"
    attempts = node_start["failover"]["attempts"]
    assert [a["connection_id"] for a in attempts] == ["anthropic"]
    assert attempts[0]["reason"]  # non-empty, human-readable

    node_done = next(d for n, d in events if n == "node_done" and d["node_id"] == "draft")
    assert "failover" in node_done


def test_ac4_plain_pin_carries_no_failover_key(monkeypatch) -> None:
    """Control case: a single resolvable id is a plain pin, not a failover —
    `node_start` must NOT carry a `failover` key at all, so the two are
    programmatically distinguishable."""
    graph = _one_llm_node_graph({"providerIds": ["openrouter"]})
    openrouter = _WorksAdapter()

    events = _run(
        graph, _connections(), _store(), {"openrouter": openrouter}, monkeypatch,
    )

    node_start = next(d for n, d in events if n == "node_start" and d["node_id"] == "draft")
    assert "failover" not in node_start
    node_done = next(d for n, d in events if n == "node_done" and d["node_id"] == "draft")
    assert "failover" not in node_done


# ── AC#6 — zero observable change for today's shapes ────────────────────────


def test_ac6_single_provider_id_first_event_failure_is_honest_error_no_retry(monkeypatch) -> None:
    """No second id to fall back to -- must behave exactly like today: one
    node_start, then one node_phase (the synthetic lead-in every real
    adapter's `stream_events()` emits before touching the provider -- B3,
    ARCH bounce, 2026-10-02: this must be replayed, not silently dropped),
    then one node_error, no hang, no silent mock. Uses the
    probe-passes-but-first-real-attempt-fails fake: with nothing left to
    retry, a negative probe would change nothing here either (engine.py
    deliberately falls through rather than reporting a probe-shaped
    resolution error for the only candidate there is), so the genuine
    failure is what must surface."""
    graph = _one_llm_node_graph({"providerIds": ["anthropic"]})
    claude = _ProbePassesButFirstRealAttemptFailsAdapter()

    events = _run(graph, _connections(), _store(), {"claude": claude}, monkeypatch)

    assert len(claude.calls) == 1
    node_starts = [d for n, d in events if n == "node_start" and d["node_id"] == "draft"]
    assert len(node_starts) == 1
    assert node_starts[0]["connection_id"] == "anthropic"
    assert "failover" not in node_starts[0]

    # B3 — exact event sequence for this node, not just the final status:
    # the original (pre-story) `async for` always emitted the lead-in
    # node_phase before a stream failure; this story's probe/peek rewrite
    # must reproduce that byte-for-byte (AC#6).
    node_events = [n for n, d in events if d.get("node_id") == "draft"]
    assert node_events == ["node_start", "node_phase", "node_error"]

    node_error = next(d for n, d in events if n == "node_error" and d["node_id"] == "draft")
    assert node_error["connection_id"] == "anthropic"
    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "error"


def test_ac6_exhausting_a_longer_list_still_ends_in_honest_resolution_error(monkeypatch) -> None:
    """Every id fails to *resolve* (not a runtime failure) -- exhausting the
    whole list must still raise today's honest ProviderResolutionError
    shape (adapter: "unresolved"), never a silent mock/blank result."""
    graph = _one_llm_node_graph({"providerIds": ["ghost-a", "ghost-b"]})

    events = _run(graph, _connections(), _store(), {}, monkeypatch)

    node_start = next(d for n, d in events if n == "node_start" and d["node_id"] == "draft")
    assert node_start["adapter"] == "unresolved"
    node_error = next(d for n, d in events if n == "node_error" and d["node_id"] == "draft")
    assert "ghost-b" in node_error["error"]
    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "error"
