"""
EXPERIMENTAL — Laya `decision` node (ADR-0005, spike).

The central guarantee of ADR-0005 is item 5: a `decision` node's result is
evidence attached to its own `node_done`, never a value anything in
`execute_harness`'s routing/gate/HITL logic reads. The test that actually
proves that ("advisory de verdade, não só de palavra") is
`test_removing_the_decision_node_does_not_change_any_other_node_result`
below: the same graph, run twice — once with a `decision` node wired in
between a conditional gate and its upstream, once with that node deleted and
the edge rewired directly — must produce the exact same gate verdict and the
exact same branch taken for every other node.

The `decision` node never touches the normal provider/adapter path (no
`providerIds`, no OH_SECRETS): it POSTs to a separate Laya loopback process
over plain HTTP (`backend/laya_loopback/server.py`). These tests inject an
`httpx.MockTransport` via `execute_harness(..., decision_transport=...)`
instead of actually starting that process — unit tests must not depend on
a GPU-bound local model server being up.
"""
from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from adapters.base import AdapterConfig, AdapterResult, AgentAdapter
from engine import STATUS_ERROR, RunControl, execute_harness
from secret_store.memory import MemorySecrets


class _ScriptedAdapter(AgentAdapter):
    """Fixed output per node label — never touches the network."""

    def __init__(self, outputs_by_label: dict[str, str]) -> None:
        self._outputs = outputs_by_label

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        label = config.extra.get("label", "")
        return AdapterResult(content=self._outputs.get(label, "no script"))

    async def stream(self, prompt: str, config: AdapterConfig):
        yield self._outputs.get(config.extra.get("label", ""), "no script")


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
        }
    }


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


def _ok_transport(model_result: dict | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/predict"
        body = json.loads(request.content.decode("utf-8"))
        assert "state" in body and "questions" in body
        return httpx.Response(
            200,
            json={
                "schema_version": "oharness-decision-node-v1",
                "model_result": model_result or {"answers": {"needs_review": {"noul": 0.1}}},
                "latency_ms": 12.3,
            },
        )

    return httpx.MockTransport(handler)


def _down_transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    return httpx.MockTransport(handler)


def _run(
    graph: dict,
    outputs_by_label: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    decision_transport: httpx.MockTransport,
) -> list[tuple[str, dict]]:
    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: _ScriptedAdapter(outputs_by_label))

    async def go() -> list[str]:
        control = RunControl("t1")
        return [
            c
            async for c in execute_harness(
                graph,
                execution_mode="live",
                control=control,
                run_id="t1",
                connections=_connections(),
                secrets_store=MemorySecrets(),
                decision_transport=decision_transport,
            )
        ]

    return _events(asyncio.run(go()))


def _graph_with_decision() -> dict:
    return {
        "nodes": [
            {"id": "start", "type": "input", "data": {"label": "Start", "prompt": "ACCEPT this please"}},
            {
                "id": "laya",
                "type": "decision",
                "data": {
                    "label": "Laya triage",
                    "decisionQuestions": {
                        "needs_review": {"type": "noul", "instructions": "Does this need human review?"}
                    },
                },
            },
            {"id": "gate", "type": "agent", "data": {"label": "Gate", "providerIds": ["anthropic"]}},
            {"id": "accepted", "type": "agent", "data": {"label": "Accepted", "providerIds": ["anthropic"]}},
            {"id": "rejected", "type": "agent", "data": {"label": "Rejected", "providerIds": ["anthropic"]}},
        ],
        "edges": [
            {"source": "start", "target": "laya"},
            {"source": "laya", "target": "gate"},
            {"source": "gate", "target": "accepted", "data": {"condition": "accept"}},
            {"source": "gate", "target": "rejected", "data": {"condition": "reject"}},
        ],
    }


def _graph_without_decision() -> dict:
    graph = _graph_with_decision()
    graph["nodes"] = [n for n in graph["nodes"] if n["id"] != "laya"]
    graph["edges"] = [e for e in graph["edges"] if e["source"] != "laya"]
    graph["edges"].insert(0, {"source": "start", "target": "gate"})
    return graph


def test_decision_node_attaches_evidence_and_passes_through_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    events = _run(
        _graph_with_decision(),
        {"Gate": "Verdict: ACCEPT — looks good."},
        monkeypatch,
        _ok_transport({"answers": {"needs_review": {"noul": 0.1}}}),
    )

    laya_done = next(d for n, d in events if n == "node_done" and d["node_id"] == "laya")
    assert laya_done["output"] == "ACCEPT this please"  # pass-through, unchanged
    result = laya_done["decisionResult"]
    assert result["authority"] == "advisory-shadow"
    assert result["schema_version"] == "oharness-decision-node-v1"
    assert result["model_result"] == {"answers": {"needs_review": {"noul": 0.1}}}
    assert result["latency_ms"] == 12.3

    node_dones = {d["node_id"] for n, d in events if n == "node_done"}
    assert node_dones == {"start", "laya", "gate", "accepted"}


def test_removing_the_decision_node_does_not_change_any_other_node_result(monkeypatch: pytest.MonkeyPatch) -> None:
    """The ADR-0005 guarantee: same gate verdict, same branch taken, with or
    without the decision node — only `decisionResult` differs (present vs
    absent). This is what makes "advisory" true in behaviour, not just in a
    docstring."""
    scripted_outputs = {"Gate": "This does not meet the bar — REJECT."}

    with_decision = _run(_graph_with_decision(), scripted_outputs, monkeypatch, _ok_transport())
    without_decision = _run(_graph_without_decision(), scripted_outputs, monkeypatch, _ok_transport())

    def _outcome(events: list[tuple[str, dict]]) -> dict:
        node_dones = {d["node_id"]: d["output"] for n, d in events if n == "node_done"}
        skipped = {d["node_id"] for n, d in events if n == "node_skipped"}
        harness_done = next(d for n, d in events if n == "harness_done")
        return {
            "gate_output": node_dones.get("gate"),
            "accepted_ran": "accepted" in node_dones,
            "rejected_ran": "rejected" in node_dones,
            "skipped": skipped,
            "status": harness_done["status"],
            "nodes_run_excluding_decision": harness_done["nodes_run"] - (1 if "laya" in node_dones else 0),
        }

    assert _outcome(with_decision) == _outcome(without_decision)


def test_laya_loopback_down_is_an_honest_node_error_never_a_fabricated_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events = _run(
        _graph_with_decision(),
        {"Gate": "Verdict: ACCEPT — looks good."},
        monkeypatch,
        _down_transport(),
    )

    laya_error = next(d for n, d in events if n == "node_error" and d["node_id"] == "laya")
    assert "laya" in laya_error["error"].lower() or "loopback" in laya_error["error"].lower()

    # Dishonest-fallback guard: no decisionResult anywhere when the loopback
    # never answered, and the run stops rather than guessing a verdict.
    assert not any(n == "node_done" and d.get("node_id") == "laya" for n, d in events)
    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == STATUS_ERROR
