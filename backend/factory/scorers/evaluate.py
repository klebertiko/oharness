"""Deterministic checks a scorer can apply from evidence already on the run.

A failing check is a score below the pass line. The result is computed here so a test can
stand in for a judge without calling a model. Unknown evidence fails closed only when the
check itself is not one of the known checks; a known check with nothing to read passes,
because absence is not a recorded failure.
"""
from __future__ import annotations

from factory.definition_rules import DETERMINISTIC_CHECKS

CHECKS = DETERMINISTIC_CHECKS


def evaluate(check: str, evidence: dict | None) -> tuple[bool, float, str]:
    """`(passed, score, reason)`. `reason` is empty when the check passed."""
    if check not in CHECKS:
        raise ValueError(check)
    evidence = evidence or {}
    failed = _failed(check, evidence)
    if failed:
        return False, 0.0, check
    return True, 1.0, ''


def _failed(check: str, evidence: dict) -> bool:
    if check == 'ci_failed':
        return evidence.get('ci') == 'failed'
    if check == 'qa_rejected':
        return evidence.get('qa') == 'rejected'
    if check == 'sec_found':
        return evidence.get('sec') == 'found'
    if check == 'gate_changes':
        return evidence.get('gate') == 'changes'
    if check == 'pr_closed_unmerged':
        return evidence.get('pr') == 'closed'
    if check == 'returns_over_cap':
        returns, cap = evidence.get('returns'), evidence.get('cap', 3)
        return isinstance(returns, int) and isinstance(cap, int) and returns > cap
    if check == 'human_intervention':
        count = evidence.get('interventions')
        return isinstance(count, int) and count > 0
    cost, envelope = evidence.get('cost'), evidence.get('envelope')
    return isinstance(cost, (int, float)) and isinstance(envelope, (int, float)) and cost > envelope
