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
    """`outputs` that also remembers the last result and what its node produced before.

    A plain dict keeps one slot per node, so a node re-run by a Gate retry that
    hands back the same text overwrites the slot and the repetition is lost.
    Nothing but the last write is kept, so memory stays bounded.
    """

    def __init__(self) -> None:
        super().__init__()
        self._last: tuple[str, str] = ("", "")

    def __setitem__(self, key: str, value: str) -> None:
        before = self.get(key)
        super().__setitem__(key, value)
        if isinstance(value, str) and value:
            self._last = (value, before if isinstance(before, str) else "")

    def last_two(self) -> tuple[str, str]:
        """(last result, what the same node produced the time before, else "").

        Repetition is a node handing back what it already handed back; two
        different nodes passing the same text along is not a lack of progress.
        """
        return self._last


def _norm(text: str) -> str:
    return " ".join(text.lower().split())


def run_facts(*, node_data: dict, stop: bool, last_output: str, previous_output: str) -> Facts:
    last = _norm(last_output)
    goal = node_data.get("goal")
    goal_met = isinstance(goal, str) and bool(_norm(goal)) and _norm(goal) in last
    repeated = bool(last) and bool(previous_output) and last == _norm(previous_output)
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
