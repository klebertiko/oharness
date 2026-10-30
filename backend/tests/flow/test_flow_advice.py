"""Perception from structured run facts only (ADR 0062)."""
from __future__ import annotations

from flow.advice import advice_event, run_facts


def _facts(**over):
    base = {"node_data": {}, "stop": False, "last_output": "", "previous_output": ""}
    base.update(over)
    return run_facts(**base)


def test_a_quiet_run_matches_and_acts() -> None:
    event = advice_event("n1", _facts())
    assert (event["action"], event["takes_step"]) == ("act", True)
    assert event["facts"] == {"stop": False, "unsafe": False, "goal_met": False, "repeated": False}


def test_repeating_the_last_result_is_no_progress_signal() -> None:
    event = advice_event("n1", _facts(last_output="same", previous_output="same"))
    assert event["facts"]["repeated"] is True
    assert event["reason"] == "no new progress signal; take the known step"


def test_empty_results_are_not_a_repetition() -> None:
    assert _facts(last_output="", previous_output="").band == "matched"


def test_repetition_ignores_case_and_whitespace_only() -> None:
    assert _facts(last_output="A  b\n", previous_output="a b").band == "no_signal"


def test_node_goal_met_when_the_last_result_says_so() -> None:
    facts = _facts(node_data={"goal": "all tests green"}, last_output="Report: ALL TESTS GREEN.")
    assert advice_event("n1", facts)["action"] == "close"
    assert advice_event("n1", facts)["reason"] == "public checks passed"


def test_node_goal_not_met_without_a_goal_text() -> None:
    assert _facts(node_data={"goal": ""}, last_output="anything").goal_met is False
    assert _facts(node_data={"goal": 3}, last_output="3").goal_met is False


def test_only_a_literal_true_marks_a_step_unsafe() -> None:
    assert _facts(node_data={"unsafe": True}).unsafe is True
    assert _facts(node_data={"unsafe": "yes"}).unsafe is False


def test_the_operator_stop_closes() -> None:
    event = advice_event("n1", _facts(stop=True))
    assert (event["action"], event["reason"], event["takes_step"]) == ("close", "operator said to stop", False)
