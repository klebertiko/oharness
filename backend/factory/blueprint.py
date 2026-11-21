"""Conditional entry, routes and gates for a Forja blueprint.

A condition is a sentence. The clauses the Forja can judge are `has label <id>`,
`stage is <name>`, `returns above <n>`, `answer is <word>` and `always`, joined by `and`.
A sentence with none of those clauses does not hold. Quality, security and human gates
stay in the definition policy; this module does not remove them.
"""
from __future__ import annotations

import re

_LABEL = re.compile(r'has label ([a-z0-9-]+)', re.IGNORECASE)
_STAGE = re.compile(r'stage is ([a-z_]+)', re.IGNORECASE)
_RETURNS = re.compile(r'returns above (\d+)', re.IGNORECASE)
_ANSWER = re.compile(r'answer is ([a-z0-9-]+)', re.IGNORECASE)


def holds(when: str | None, facts: dict) -> bool:
    text = (when or '').strip()
    if not text or text.lower() == 'always':
        return True
    labels = {str(label).lower() for label in facts.get('labels') or []}
    seen = False
    for match in _LABEL.finditer(text):
        seen = True
        if match.group(1).lower() not in labels:
            return False
    for match in _STAGE.finditer(text):
        seen = True
        if match.group(1).lower() != str(facts.get('stage') or '').lower():
            return False
    for match in _RETURNS.finditer(text):
        seen = True
        if int(facts.get('returns') or 0) <= int(match.group(1)):
            return False
    for match in _ANSWER.finditer(text):
        seen = True
        if match.group(1).lower() != str(facts.get('answer') or '').lower():
            return False
    return seen


def entry_stage(blueprint: dict | None, facts: dict) -> str:
    for rule in (blueprint or {}).get('entry') or []:
        if isinstance(rule, dict) and holds(rule.get('when'), facts):
            return str(rule.get('to') or 'intake')
    return 'intake'


def matching_gate(blueprint: dict | None, stage: str, facts: dict) -> dict | None:
    for gate in (blueprint or {}).get('gates') or []:
        if isinstance(gate, dict) and gate.get('stage') == stage and holds(gate.get('when'), facts):
            return gate
    return None


def route_decision(blueprint: dict | None, stage: str, facts: dict) -> tuple[dict | None, bool]:
    """The first route that holds, and whether a route was skipped only because its return cap was passed."""
    capped = False
    returns = int(facts.get('returns') or 0)
    for route in (blueprint or {}).get('routes') or []:
        if not isinstance(route, dict) or route.get('from') != stage:
            continue
        cap = route.get('maxReturns')
        if isinstance(cap, int) and returns > cap:
            capped = True
            continue
        if holds(route.get('when'), facts):
            return route, False
    return None, capped


def simulate(blueprint: dict | None, facts: dict) -> list[dict]:
    """Walk entry, then one route per stage, stopping at a gate, an end, or a repeated stage."""
    stage = entry_stage(blueprint, facts)
    path: list[dict] = []
    seen: set[str] = set()
    while stage and stage not in seen and stage != 'end':
        seen.add(stage)
        gate = matching_gate(blueprint, stage, facts)
        path.append({'stage': stage, 'gate': gate.get('id') if gate else None})
        if gate:
            break
        route, _capped = route_decision(blueprint, stage, facts)
        if route is None:
            break
        if route.get('to') == 'end':
            path.append({'stage': 'end', 'reason': route.get('reason') or ''})
            break
        stage = str(route.get('to') or '')
    return path
