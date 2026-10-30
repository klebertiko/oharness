"""Flow advice for a run: structured facts in, one piece of evidence out (ADR 0065).

The perception is built only from facts the run already holds -- the operator's
stop, a step an author marked unsafe, the node's own goal and a repeated last
result. No model reads text here and nothing asks a neighbour skill to exist.
The event is evidence: the engine never reads it back to decide what runs.
"""
from __future__ import annotations

from typing import Any, Callable

from .policy import Advice, Facts, advise_facts

AUTHORITY = "advisory"


class OutputTrail(dict):
    """`outputs` that also remembers the order results arrived in, including a
    node's repeated result (a plain dict keeps one slot per node)."""

    def __init__(self) -> None:
        super().__init__()
        self.history: list[str] = []

    def __setitem__(self, key: str, value: str) -> None:
        super().__setitem__(key, value)
        if value:
            self.history.append(value)


def _norm(text: str) -> str:
    return " ".join(text.lower().split())


def run_facts(*, node_data: dict, stop: bool, last_output: str, previous_output: str) -> Facts:
    last = _norm(last_output)
    goal = node_data.get("goal")
    goal_met = isinstance(goal, str) and bool(_norm(goal)) and _norm(goal) in last
    repeated = bool(last) and last == _norm(previous_output)
    return Facts(
        band="no_signal" if repeated else "matched",
        stop=stop,
        unsafe=node_data.get("unsafe") is True,
        goal_met=goal_met,
    )


def advice_event(node_id: str, facts: Facts, advise: Callable[[Facts], Advice] = advise_facts) -> dict[str, Any]:
    advice = advise(facts)
    return {
        "node_id": node_id,
        "action": advice.action,
        "reason": advice.reason,
        "takes_step": advice.takes_step,
        "authority": AUTHORITY,
        "facts": {
            "stop": facts.stop,
            "unsafe": facts.unsafe,
            "goal_met": facts.goal_met,
            "repeated": facts.band == "no_signal",
        },
    }
