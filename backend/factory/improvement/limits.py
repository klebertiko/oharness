"""Hard limits on a proposed definition. Enforced here, before a person is asked.

A proposal that would weaken a quality, security or human gate, raise a permission mode,
add a merge, lower a scorer's pass line, turn a scorer off, or widen network or secrets
is refused with a reason. The Forja never merges, and there is no way to skip the person.
"""
from __future__ import annotations

import re

from factory.definition import stage_flags
from factory.definition_rules import mode_rank

_INDEPENDENCE = {'off': 0, 'warn': 1, 'require': 2}
_SPEC = {'optional': 0, 'required': 1}
_GATE_STAGES = ('review', 'verify', 'spec')
_MERGE_KEYS = frozenset({'merge', 'automerge', 'mergeaction'})
_MERGE_LINE = re.compile(r'(?im)^\s*action\s*:\s*merge\s*$')


def _reason(code: str, path: str, message: str) -> dict:
    return {'code': code, 'path': path, 'message': message}


def _policy(defn: dict) -> dict:
    return defn.get('policy') or {}


def _strength(defn: dict, stage: str) -> tuple[bool, bool]:
    """`(required, enabled)` for a gate. Falls back to the declared stage when the definition is partial."""
    if defn.get('agents') and defn.get('policy') is not None:
        try:
            flags = stage_flags(defn)[stage]
            return bool(flags['required']), bool(flags['enabled'])
        except (KeyError, TypeError):
            pass
    explicit = (defn.get('stages') or {}).get(stage) or {}
    return bool(explicit.get('required')), bool(explicit.get('enabled', True))


def _secrets(defn: dict) -> set[str]:
    found: set[str] = set()
    for name in defn.get('secrets') or []:
        if isinstance(name, str):
            found.add(name)
    for agent in (defn.get('agents') or {}).values():
        if isinstance(agent, dict):
            for name in agent.get('secrets') or []:
                if isinstance(name, str):
                    found.add(name)
    return found


def _hosts(policy: dict | None, key: str) -> set[str] | None:
    """`None` means the scope declares nothing (no restriction from this scope)."""
    if not isinstance(policy, dict):
        return None
    values = policy.get(key) or []
    return {str(host).lower() for host in values}


def _network_widened(before: dict | None, after: dict | None, path: str) -> list[dict]:
    if not isinstance(before, dict) and not isinstance(after, dict):
        return []
    if isinstance(before, dict) and not isinstance(after, dict):
        return [_reason('widen_network', path, 'Removing a network policy leaves outbound access unrestricted.')]
    if not isinstance(before, dict) or not isinstance(after, dict):
        return []
    reasons = []
    allowed_before, allowed_after = _hosts(before, 'allowedHosts') or set(), _hosts(after, 'allowedHosts') or set()
    denied_before, denied_after = _hosts(before, 'deniedHosts') or set(), _hosts(after, 'deniedHosts') or set()
    added = sorted(allowed_after - allowed_before)
    if added:
        reasons.append(_reason('widen_network', f'{path}.allowedHosts', 'The proposal allows hosts the active policy does not.'))
    removed = sorted(denied_before - denied_after)
    if removed:
        reasons.append(_reason('widen_network', f'{path}.deniedHosts', 'The proposal drops a host the active policy denies.'))
    extends_before = set(before.get('extends') or [])
    extends_after = set(after.get('extends') or [])
    if extends_after - extends_before:
        reasons.append(_reason('widen_network', f'{path}.extends', 'The proposal adds a broader network policy.'))
    return reasons


def _merge_added(before, after, path: str) -> list[dict]:
    reasons: list[dict] = []
    if isinstance(after, dict):
        base = before if isinstance(before, dict) else {}
        for key, value in after.items():
            child = f'{path}.{key}'
            if str(key).lower().replace('_', '') in _MERGE_KEYS and key not in base:
                reasons.append(_reason('add_merge', child, 'The proposal adds a merge. The Forja never merges.'))
            reasons.extend(_merge_added(base.get(key), value, child))
    elif isinstance(after, list):
        base = before if isinstance(before, list) else []
        for index, value in enumerate(after):
            previous = base[index] if index < len(base) else None
            if isinstance(value, str) and value.strip().lower() == 'merge' and value not in base:
                reasons.append(_reason('add_merge', f'{path}[{index}]', 'The proposal adds a merge. The Forja never merges.'))
            reasons.extend(_merge_added(previous, value, f'{path}[{index}]'))
    elif isinstance(after, str):
        previous = before if isinstance(before, str) else ''
        if _MERGE_LINE.search(after) and not _MERGE_LINE.search(previous):
            reasons.append(_reason('add_merge', path, 'The proposal adds a merge action. The Forja never merges.'))
    return reasons


def _passing(scorer: dict) -> float | None:
    value = scorer.get('passingScore', scorer.get('threshold'))
    return float(value) if isinstance(value, (int, float)) else None


def check(before: dict, after: dict) -> list[dict]:
    """Reasons the proposal cannot be shown to a person. Empty means it may be reviewed."""
    reasons: list[dict] = []
    for stage in _GATE_STAGES:
        before_required, before_enabled = _strength(before, stage)
        after_required, after_enabled = _strength(after, stage)
        if before_required and not after_required:
            reasons.append(_reason('weaken_gate', f'stages.{stage}', f'The {stage} gate would no longer be required.'))
        if before_enabled and not after_enabled:
            reasons.append(_reason('weaken_gate', f'stages.{stage}', f'The {stage} gate would be turned off.'))
    before_policy, after_policy = _policy(before), _policy(after)
    if _INDEPENDENCE.get(str(after_policy.get('reviewIndependence')), 2) < _INDEPENDENCE.get(str(before_policy.get('reviewIndependence')), 2):
        reasons.append(_reason('weaken_gate', 'policy.reviewIndependence', 'Review would be less independent than it is now.'))
    if _SPEC.get(str(after_policy.get('specApproval')), 1) < _SPEC.get(str(before_policy.get('specApproval')), 1):
        reasons.append(_reason('weaken_gate', 'policy.specApproval', 'Spec approval would stop being required.'))
    if before_policy.get('requireSpec') and not after_policy.get('requireSpec'):
        reasons.append(_reason('weaken_gate', 'policy.requireSpec', 'A spec would no longer be required.'))
    before_returns, after_returns = before_policy.get('maxReviewReturns'), after_policy.get('maxReviewReturns')
    if isinstance(before_returns, int) and isinstance(after_returns, int) and after_returns > before_returns:
        reasons.append(_reason('weaken_gate', 'policy.maxReviewReturns', 'More returns would be allowed before the gate holds.'))
    before_mode, after_mode = before_policy.get('maxPermissionMode'), after_policy.get('maxPermissionMode')
    if isinstance(before_mode, str) and isinstance(after_mode, str):
        try:
            if mode_rank(after_mode) > mode_rank(before_mode):
                reasons.append(_reason('raise_permission', 'policy.maxPermissionMode', 'The highest permission mode would go up.'))
        except ValueError:
            reasons.append(_reason('raise_permission', 'policy.maxPermissionMode', 'The permission mode is not one the Forja knows.'))
    before_agents, after_agents = before.get('agents') or {}, after.get('agents') or {}
    for name, agent in after_agents.items():
        previous = before_agents.get(name)
        if not isinstance(agent, dict) or not isinstance(previous, dict):
            continue
        previous_mode = (previous.get('permissions') or {}).get('mode')
        next_mode = (agent.get('permissions') or {}).get('mode')
        if isinstance(previous_mode, str) and isinstance(next_mode, str):
            try:
                if mode_rank(next_mode) > mode_rank(previous_mode):
                    reasons.append(_reason('raise_permission', f'agents.{name}.permissions.mode', 'An agent would be allowed to do more.'))
            except ValueError:
                reasons.append(_reason('raise_permission', f'agents.{name}.permissions.mode', 'The permission mode is not one the Forja knows.'))
        reasons.extend(_network_widened(previous.get('networkPolicy'), agent.get('networkPolicy'), f'agents.{name}.networkPolicy'))
    added_secrets = sorted(_secrets(after) - _secrets(before))
    if added_secrets:
        reasons.append(_reason('add_secret', 'secrets', 'The proposal grants a secret the active definition does not.'))
    reasons.extend(_network_widened(before.get('networkPolicy'), after.get('networkPolicy'), 'networkPolicy'))
    before_scorers, after_scorers = before.get('scorers') or {}, after.get('scorers') or {}
    for name, scorer in before_scorers.items():
        if not isinstance(scorer, dict):
            continue
        nxt = after_scorers.get(name)
        if not isinstance(nxt, dict):
            reasons.append(_reason('remove_scorer', f'scorers.{name}', 'The proposal removes a scorer.'))
            continue
        if scorer.get('enabled', True) and not nxt.get('enabled', True):
            reasons.append(_reason('disable_scorer', f'scorers.{name}.enabled', 'The proposal turns a scorer off.'))
        if scorer.get('selfImprovement') and not nxt.get('selfImprovement', False):
            reasons.append(_reason('disable_scorer', f'scorers.{name}.selfImprovement', 'The proposal stops a scorer from feeding improvement.'))
        before_line, after_line = _passing(scorer), _passing(nxt)
        if before_line is not None and after_line is not None and after_line < before_line:
            reasons.append(_reason('lower_threshold', f'scorers.{name}.passingScore', 'The pass line would be lower.'))
    improvement = after.get('selfImprovement') or {}
    if isinstance(improvement, dict) and improvement.get('reviewerType') == 'none':
        reasons.append(_reason('skip_human', 'selfImprovement.reviewerType', 'A proposal is always decided by a person.'))
    reasons.extend(_merge_added(before, after, '$'))
    return reasons
