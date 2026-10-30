"""Flow advice (ADR 0065) is evidence, never a gate.

The contract, in the order it matters: with the switch off the engine does not
compute anything and emits nothing; with it on, gates and the terminal status
of the run are the same as with it off -- even if the advisor answers with the
most intrusive action it has; and the operator's stop still ends the run.
"""
from __future__ import annotations

import asyncio
import json

import pytest

import engine
from engine import STATUS_COMPLETE, STATUS_STOPPED, RunControl, execute_harness
from flow.policy import Advice


def _events(chunks: list[str]) -> list[tuple[str, dict]]:
    out = []
    for c in chunks:
        if not c.startswith("event: "):
            continue
        name, _, rest = c.partition("\n")
        out.append((name.removeprefix("event: ").strip(), json.loads(rest.strip().removeprefix("data: "))))
    return out


def _graph(**middle_data) -> dict:
    return {
        "nodes": [
            {"id": "in", "type": "input", "data": {"label": "In", "prompt": "build it"}},
            {"id": "work", "type": "agent", "data": {"label": "Work", "adapter": "mock", **middle_data}},
            {"id": "gate", "type": "agent", "data": {"label": "Gate", "adapter": "mock"}},
            {"id": "out", "type": "output", "data": {"label": "Out"}},
        ],
        "edges": [
            {"source": "in", "target": "work"},
            {"source": "work", "target": "gate"},
            {"source": "gate", "target": "out"},
        ],
    }


def _run(graph: dict, *, flow=None, stop_first: bool = False) -> list[tuple[str, dict]]:
    async def go() -> list[str]:
        control = RunControl("flow-t")
        if stop_first:
            control.stop.set()
        kwargs = {} if flow is None else {"flow_advice": flow}
        return [c async for c in execute_harness(graph, execution_mode="mock", control=control, run_id="flow-t", **kwargs)]

    return _events(asyncio.run(go()))


def _contract(events: list[tuple[str, dict]]) -> dict:
    """What a run decided: which nodes ran or were skipped, and how it ended."""
    return {
        "done": [d["node_id"] for n, d in events if n == "node_done"],
        "skipped": [d["node_id"] for n, d in events if n == "node_skipped"],
        "retries": [d["node_id"] for n, d in events if n == "gate_retry"],
        "status": next(d["status"] for n, d in events if n == "harness_done"),
        "nodes_run": next(d["nodes_run"] for n, d in events if n == "harness_done"),
        "stopped_at": [d.get("at_node") for n, d in events if n == "run_stopped"],
    }


def _advisor_saying(action: str, takes_step: bool = False):
    def advisor(*_args, **_kwargs) -> Advice:
        return Advice(action, "test advisor", takes_step)  # type: ignore[arg-type]

    return advisor


def test_switch_off_computes_nothing_and_emits_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_a, **_k):
        raise AssertionError("the advisor ran with the switch off")

    monkeypatch.setattr(engine, "advise_facts", boom)
    for flow in (None, False):
        events = _run(_graph(), flow=flow)
        assert not [n for n, _ in events if n == "flow_advice"]
        assert _contract(events)["status"] == STATUS_COMPLETE


def test_switch_on_emits_one_advice_per_node_with_action_and_reason() -> None:
    events = _run(_graph(), flow=True)
    advice = [d for n, d in events if n == "flow_advice"]
    assert [a["node_id"] for a in advice] == ["in", "work", "gate", "out"]
    assert all(a["action"] and a["reason"] for a in advice)
    assert all(a["authority"] == "advisory" for a in advice)


@pytest.mark.parametrize("action", ["act", "plan_once", "raise", "close", "block", "abstain", "request_neighbor"])
def test_gates_and_terminal_status_are_the_same_whatever_the_advisor_says(monkeypatch: pytest.MonkeyPatch, action: str) -> None:
    off = _contract(_run(_graph()))
    monkeypatch.setattr(engine, "advise_facts", _advisor_saying(action))
    on = _contract(_run(_graph(), flow=True))
    assert on == off
    assert off["status"] == STATUS_COMPLETE and off["done"] == ["in", "work", "gate", "out"]


def test_abstention_is_recorded_and_the_graph_keeps_going(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(engine, "advise_facts", _advisor_saying("abstain"))
    events = _run(_graph(), flow=True)
    assert {d["action"] for n, d in events if n == "flow_advice"} == {"abstain"}
    assert _contract(events)["done"] == ["in", "work", "gate", "out"]


@pytest.mark.parametrize("flow", [None, False, True])
def test_act_plus_operator_stop_still_stops_the_run(monkeypatch: pytest.MonkeyPatch, flow) -> None:
    monkeypatch.setattr(engine, "advise_facts", _advisor_saying("act", takes_step=True))
    result = _contract(_run(_graph(), flow=flow, stop_first=True))
    assert result["status"] == STATUS_STOPPED
    assert result["done"] == [] and result["stopped_at"] == ["in"]


def test_operator_stop_is_reported_as_the_reason() -> None:
    events = _run(_graph(), flow=True, stop_first=True)
    first = next(d for n, d in events if n == "flow_advice")
    assert (first["action"], first["reason"]) == ("close", "operator said to stop")
    assert first["facts"]["stop"] is True


def test_unsafe_marker_and_goal_reach_the_perception() -> None:
    events = _run(_graph(unsafe=True), flow=True)
    work = next(d for n, d in events if n == "flow_advice" and d["node_id"] == "work")
    assert (work["action"], work["reason"]) == ("close", "next step is unsafe")
    assert _contract(events)["status"] == STATUS_COMPLETE  # evidence: the node still ran


def test_repeated_last_result_reads_as_no_progress_signal() -> None:
    events = _run(_graph(), flow=True)
    by_node = {d["node_id"]: d for n, d in events if n == "flow_advice"}
    # mock output of two different nodes is not identical -> no repetition fact
    assert by_node["gate"]["facts"]["repeated"] is False
