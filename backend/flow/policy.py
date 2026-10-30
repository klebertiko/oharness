"""Map a perception to one flow action.

Copied unchanged (apart from this note) from src/laya-playground/tools/flow_policy/policy.py.
Evidence only: ADR 0005 and ADR 0065 keep it from ever steering a gate or an edge.

Numeric comparisons stay in code. A caller may ask a model what a short text
says; this module only maps that reading. It does not load a model, invoke a
skill, move a board, or merge.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

Band = Literal["matched", "too_easy", "too_hard", "no_signal", "interrupted"]
Action = Literal["act", "plan_once", "raise", "close", "block", "abstain", "request_neighbor"]

# Uncalibrated. A missed stop or unsafe step is the hyperfocus failure in the
# flow study (44 unsafe steps, never closed). Band confidence abstains until
# a labelled set picks a real floor.
STOP_FLOOR = 0.5
BAND_FLOOR = 0.7


FLOW_QUESTIONS: dict[str, dict[str, Any]] = {
    "band": {
        "type": "choice",
        "instructions": "What does the text say about the task compared with current skill?",
        "criteria": {
            "matched": "difficulty matches current skill",
            "too_easy": "the task is easier than current skill",
            "too_hard": "the task is harder than current skill",
            "no_signal": "there is no new progress signal",
            "interrupted": "the same task remains after an interruption",
        },
    },
    "stop": {
        "type": "noul",
        "instructions": "Does the text say to stop?",
        "criteria": {"true": "an explicit stop", "false": "no stop"},
    },
    "unsafe": {
        "type": "noul",
        "instructions": "Does the text say the next step is unsafe?",
        "criteria": {"true": "the next step is unsafe", "false": "the next step is safe"},
    },
    "disagree": {
        "type": "noul",
        "instructions": "Does the text say attention and recorded progress disagree?",
        "criteria": {
            "true": "attention and recorded progress disagree",
            "false": "attention and recorded progress agree",
        },
    },
}


@dataclass(frozen=True)
class Facts:
    """Comparisons already decided. No raw magnitudes."""

    band: Band
    stop: bool = False
    unsafe: bool = False
    attention_matches_progress: bool = True
    has_easier: bool = True
    has_harder: bool = True
    goal_met: bool = False


@dataclass(frozen=True)
class Perception:
    band: Band | None
    band_confidence: float
    stop: float
    unsafe: float
    disagree: float
    has_easier: bool = True
    has_harder: bool = True
    goal: float = 0.0


@dataclass(frozen=True)
class Advice:
    action: Action
    reason: str
    takes_step: bool
    neighbor: Literal["easier", "harder"] | None = None


def describe(facts: Facts) -> str:
    """Front-load the conclusion. Digits never reach the model."""

    sentences: list[str] = []
    if facts.goal_met:
        sentences.append("The full checks passed.")
    if facts.unsafe:
        sentences.append("The next step is unsafe.")
    if facts.stop:
        sentences.append("The operator said to stop.")
    if not facts.attention_matches_progress:
        sentences.append("Attention and recorded progress disagree.")
    sentences.append(
        {
            "matched": "The task difficulty matches current skill.",
            "too_easy": "The task is easier than current skill.",
            "too_hard": "The task is harder than current skill.",
            "no_signal": "There is no new progress signal.",
            "interrupted": "The same task remains after an interruption.",
        }[facts.band]
    )
    return " ".join(sentences)


def laya_payload(text: str) -> dict[str, Any]:
    state = " ".join(text.split())
    if not state:
        raise ValueError("situation text cannot be empty")
    if any(character.isdigit() for character in state):
        raise ValueError("hand Laya the conclusion, not a number")
    return {"state": state, "questions": FLOW_QUESTIONS}


def perception_from_laya(
    answers: dict[str, Any],
    *,
    has_easier: bool = True,
    has_harder: bool = True,
) -> Perception:
    band_answer = answers["band"]
    return Perception(
        band=band_answer.get("choice"),
        band_confidence=float(band_answer.get("confidence") or 0),
        stop=float(answers["stop"].get("noul") or 0),
        unsafe=float(answers["unsafe"].get("noul") or 0),
        disagree=float(answers["disagree"].get("noul") or 0),
        has_easier=has_easier,
        has_harder=has_harder,
        goal=float((answers.get("goal") or {}).get("noul") or 0),
    )


def advise(
    perception: Perception,
    *,
    stop_floor: float = STOP_FLOOR,
    band_floor: float = BAND_FLOOR,
) -> Advice:
    if perception.unsafe >= stop_floor:
        return Advice("close", "next step is unsafe", False)
    if perception.stop >= stop_floor:
        return Advice("close", "operator said to stop", False)
    if perception.disagree >= stop_floor:
        return Advice("block", "attention and progress disagree", False)
    if perception.goal >= stop_floor:
        return Advice("close", "public checks passed", False)

    if perception.band is None or perception.band_confidence < band_floor:
        return Advice("abstain", "band confidence below floor", False)

    if perception.band == "too_hard":
        if not perception.has_easier:
            return Advice("request_neighbor", "no easier neighbor to plan from", False, "easier")
        return Advice("plan_once", "task is harder than skill", True, "easier")
    if perception.band == "too_easy":
        if not perception.has_harder:
            return Advice("request_neighbor", "no harder neighbor to raise to", False, "harder")
        return Advice("raise", "task is easier than skill", True, "harder")
    if perception.band == "no_signal":
        return Advice("act", "no new progress signal; take the known step", True)
    if perception.band == "interrupted":
        return Advice("act", "resume the same task", True)
    return Advice("act", "difficulty matches skill", True)


def advise_facts(facts: Facts, **floors: float) -> Advice:
    """Code already knows the comparisons, so confidence is 1."""

    return advise(
        Perception(
            band=facts.band,
            band_confidence=1,
            stop=1 if facts.stop else 0,
            unsafe=1 if facts.unsafe else 0,
            disagree=0 if facts.attention_matches_progress else 1,
            has_easier=facts.has_easier,
            has_harder=facts.has_harder,
            goal=1 if facts.goal_met else 0,
        ),
        **floors,
    )
