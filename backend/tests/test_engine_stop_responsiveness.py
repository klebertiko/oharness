"""
Stop must interrupt a run even while an adapter is mid-generation.

Real user report: clicking Stop did nothing during a slow-yielding adapter
(Ollama; a CLI subprocess sitting between tokens with output already on
screen). The engine's per-node loop only checked `control.stop.is_set()`
*between* items the adapter had already produced -- if the adapter blocked
waiting to produce its *next* item, that check never ran again, so Stop
queued behind however long the adapter felt like taking, which from the
user's seat reads as "did nothing."

`RunControl`'s own docstring says stop is checked "at the next checkpoint,"
deliberately not mid-token -- the fix here is not to cancel a token
mid-flight, it's to make "the next checkpoint" mean "the next moment we'd
otherwise be idle waiting," not "the next moment the adapter happens to
produce something."
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

import pytest

from adapters.base import AdapterConfig, AgentAdapter, AdapterResult
from engine import RunControl, execute_harness
from secret_store.memory import MemorySecrets


class _HangingAdapter(AgentAdapter):
    """Streams one chunk, then blocks forever on its next yield -- exactly the
    shape of a slow local model or a CLI subprocess sitting mid-generation
    with nothing new to report yet."""

    def __init__(self) -> None:
        self.never = asyncio.Event()  # deliberately never set

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        return AdapterResult(content="", tokens_used=0)

    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        yield "partial"
        await self.never.wait()
        yield "unreachable"  # pragma: no cover -- never reached

    async def stream_events(self, prompt: str, config: AdapterConfig):
        yield {"kind": "text", "text": "partial"}
        await self.never.wait()
        yield {"kind": "text", "text": "unreachable"}  # pragma: no cover


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
            "secretRef": "oharness/anthropic",  # gitleaks:allow
        }
    }


def _graph() -> dict:
    return {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi"}},
            {"id": "draft", "type": "llm", "data": {"label": "Draft", "providerIds": ["anthropic"]}},
        ],
        "edges": [{"source": "in", "target": "draft"}],
    }


def test_stop_interrupts_a_slow_yielding_adapter_promptly(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = _HangingAdapter()
    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: stub)
    store = MemorySecrets()
    store.put("oharness/anthropic", "sk-ant-REAL")

    async def drive() -> list[str]:
        control = RunControl("t")
        chunks: list[str] = []
        gen = execute_harness(
            _graph(),
            execution_mode="live",
            control=control,
            connections=_connections(),
            secrets_store=store,
        )
        # Consume until the adapter's first chunk has genuinely landed, so
        # stop is requested while it is provably mid-stream, not before the
        # node even started.
        async for chunk in gen:
            chunks.append(chunk)
            if "node_stream" in chunk:
                break

        control.stop.set()

        async def drain_rest() -> None:
            async for chunk in gen:
                chunks.append(chunk)

        # The bug: today's checkpoint only fires between items the adapter
        # already produced, and _HangingAdapter never produces another one --
        # so without the fix this hangs until the timeout fires.
        await asyncio.wait_for(drain_rest(), timeout=1.0)
        return chunks

    events = _events(asyncio.run(drive()))
    assert any(name == "run_stopped" for name, _ in events)
    harness_done = next(data for name, data in events if name == "harness_done")
    assert harness_done["status"] == "stopped"


def test_cancelled_stream_closes_pending_provider_iterator():
    """Given an idle provider, when the consumer disconnects, then cancellation closes it."""
    async def drive():
        waiting = asyncio.Event()
        closed = asyncio.Event()

        async def provider():
            try:
                yield {"kind": "text", "text": "partial"}
                waiting.set()
                await asyncio.Event().wait()
            finally:
                closed.set()

        async def consume():
            async for _ in RunControl("cancelled").stream_until_stopped(provider()):
                pass

        task = asyncio.create_task(consume())
        await asyncio.wait_for(waiting.wait(), timeout=1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert closed.is_set()

    asyncio.run(drive())
