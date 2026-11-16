"""
#418 (R-PRV-11): the three subscription CLIs (claude, codex, cursor-agent)
propagate the usage and the effective model they report up to the run's
events, so the ceiling and the ledger stop falling back to `len(output)//4`
and an empty model whenever the CLI did say. When a CLI reports nothing, the
count stays an honest estimate — never an invented number.

No process is spawned: each adapter takes an injectable ``runner`` fed with a
fake CLI output.
"""
from __future__ import annotations

import asyncio
import json

import pytest

from adapters.base import AdapterConfig
from adapters.cli_claude import ClaudeCliAdapter
from adapters.cli_codex import CodexCliAdapter
from adapters.cli_cursor import CursorCliAdapter
from adapters.cli_shared import CliFailure, CliRunResult
from engine import RunControl, execute_harness


@pytest.fixture(autouse=True)
def _cli_on_path(monkeypatch: pytest.MonkeyPatch) -> None:
    for module, name in (("cli_claude", "claude"), ("cli_codex", "codex"), ("cli_cursor", "cursor-agent")):
        monkeypatch.setattr(f"adapters.{module}.find_cli", lambda _n, name=name: f"/usr/local/bin/{name}")
    monkeypatch.setattr("adapters.cli_shared.is_windows", lambda: False)
    monkeypatch.setattr("adapters.cli_cursor.is_windows", lambda: False)
    monkeypatch.setattr("adapters.cli_codex.is_windows", lambda: True)


def _runner(stdout: str, returncode: int = 0):
    async def run(argv, *, cwd, env, timeout, stdin=None):
        return CliRunResult(returncode=returncode, stdout=stdout, stderr="")
    return run


CLAUDE_OUT = json.dumps({
    "type": "result", "is_error": False, "result": "pong",
    "usage": {"input_tokens": 2, "output_tokens": 4},
    "modelUsage": {"claude-sonnet-5-20261001": {"inputTokens": 2, "outputTokens": 4}},
})
CODEX_OUT = "\n".join(json.dumps(e) for e in (
    {"type": "thread.started", "thread_id": "t1"},
    {"type": "item.completed", "item": {"type": "agent_message", "text": "pong"}},
    {"type": "turn.completed", "usage": {"input_tokens": 5, "output_tokens": 2}},
))
CURSOR_OUT = json.dumps({
    "type": "result", "is_error": False, "result": "pong", "model": "gpt-5.1",
    "usage": {"inputTokens": 3, "outputTokens": 4},
})


async def _events(adapter, model: str = "") -> list[dict]:
    return [ev async for ev in adapter.stream_events("hi", AdapterConfig(adapter="x", model=model, extra={}))]


def _usage(events: list[dict]) -> dict | None:
    return next((e for e in events if e.get("kind") == "usage"), None)


@pytest.mark.parametrize("adapter,tokens,model", [
    (ClaudeCliAdapter(runner=_runner(CLAUDE_OUT)), 6, "claude-sonnet-5-20261001"),
    (CursorCliAdapter(runner=_runner(CURSOR_OUT)), 7, "gpt-5.1"),
])
def test_cli_reports_usage_and_effective_model(adapter, tokens, model):
    events = asyncio.run(_events(adapter))
    assert "".join(e["text"] for e in events if e.get("kind") == "text") == "pong"
    assert _usage(events) == {"kind": "usage", "tokens": tokens, "model": model}


def test_codex_reports_usage_and_keeps_requested_model_when_cli_names_none():
    events = asyncio.run(_events(CodexCliAdapter(runner=_runner(CODEX_OUT)), model="gpt-5.5"))
    assert _usage(events) == {"kind": "usage", "tokens": 7, "model": "gpt-5.5"}


def test_cli_that_reports_no_usage_emits_no_invented_count():
    out = json.dumps({"type": "result", "is_error": False, "result": "pong"})
    events = asyncio.run(_events(CursorCliAdapter(runner=_runner(out))))
    assert _usage(events) is None


def test_stream_events_failure_still_raises_closed_class():
    out = json.dumps({"is_error": True, "result": "Please run claude login"})
    with pytest.raises(CliFailure):
        asyncio.run(_events(ClaudeCliAdapter(runner=_runner(out))))


def _sse(chunks: list[str]) -> list[tuple[str, dict]]:
    out = []
    for c in chunks:
        if c.startswith("event: "):
            name, _, rest = c.partition("\n")
            out.append((name.removeprefix("event: ").strip(), json.loads(rest.strip().removeprefix("data: "))))
    return out


def test_engine_node_counts_cli_usage_as_reported_with_effective_model(monkeypatch):
    adapter = ClaudeCliAdapter(runner=_runner(CLAUDE_OUT))
    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: adapter)
    connections = {"anthropic": {
        "id": "anthropic", "provider": "anthropic", "label": "Anthropic",
        "residence": "cloud", "endpoint": "https://api.anthropic.com", "enabled": True, "secretRef": None,
    }}
    graph = {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi"}},
            {"id": "draft", "type": "llm", "data": {"label": "Draft", "providerIds": ["anthropic"]}},
        ],
        "edges": [{"source": "in", "target": "draft"}],
    }

    async def run() -> list[str]:
        return [c async for c in execute_harness(
            graph, execution_mode="live", control=RunControl("t"), connections=connections,
        )]

    events = _sse(asyncio.run(run()))
    done = next(d for n, d in events if n == "node_done" and d["node_id"] == "draft")
    assert done["tokens"] == 6
    assert done["tokens_estimated"] is False
    assert done["model"] == "claude-sonnet-5-20261001"


def test_ledger_row_takes_the_effective_model_over_the_requested_one():
    from routers.execution import _usage_rows_from_events

    events = [
        {"event": "node_start", "data": {"node_id": "n", "adapter": "claude", "model": "", "connection_id": "anthropic"}},
        {"event": "node_done", "data": {"node_id": "n", "tokens": 6, "model": "claude-sonnet-5-20261001"}},
    ]
    rows = _usage_rows_from_events(events, run_id="r", source="harness", connections={})
    assert rows[0]["model"] == "claude-sonnet-5-20261001"


def test_malformed_reported_model_never_travels():
    out = json.dumps({"result": "pong", "usage": {"input_tokens": 1, "output_tokens": 1},
                      "modelUsage": {"bad model; rm -rf /": {"outputTokens": 9}}})
    events = asyncio.run(_events(ClaudeCliAdapter(runner=_runner(out)), model="claude-opus-5"))
    assert _usage(events) == {"kind": "usage", "tokens": 2, "model": "claude-opus-5"}
