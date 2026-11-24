"""Hard limits on a proposed definition. Enforced here, before a person is asked, and again when they decide.

The check fails closed. Both sides are read with the effective defaults, so an omitted key never means something looser; a
key that is removed or changes type is refused; and a field is either on the short list of things a proposal may change
freely (instructions, models, skills), judged by a rule below, or protected. A proposal that would weaken a quality, security
or human gate, raise a permission mode or a ceiling, add a merge, lower a pass line, sample less, widen network or secrets,
or change a protected field is refused with a reason. The Forja never merges, and there is no way to skip the person.
"""
from __future__ import annotations

import re

from factory import definition_rules as rules
from factory.definition import stage_flags

_INDEPENDENCE = {'off': 0, 'warn': 1, 'require': 2}
_SPEC = {'optional': 0, 'required': 1}
_MERGE_KEYS = frozenset({'merge', 'automerge', 'mergeaction'})
# A merge spelled as a step, a command or a setting. Shared with the code fixes and the notes.
MERGE_TEXT = re.compile(
    r"""\baction["']?[ \t]*[:=][ \t]*["']?merge\b"""
    r'|\bgh[ \t]+pr[ \t]+merge\b|\bgit[ \t]+merge\b|\bauto[-_ ]?merge\b|\benable[-_]?auto[-_]?merge\b'
    r'|\bmerge[-_]?pull[-_]?request\b|\bmergePullRequest\b|\bpulls/[0-9]+/merge\b',
    re.IGNORECASE)
TEXT_SCAN_MAX = 100_000  # text past this is refused rather than scanned
# Higher is looser for the first group, lower is looser for the second (ADR 0056: the trial must stay at least as careful).
_LOOSER_IF_HIGHER = ('failureThreshold', 'ageDays', 'canaryPercent')
_LOOSER_IF_LOWER = ('minSampleRuns', 'sampleDays')
_FREE = tuple(re.compile(p) for p in (
    r'agents\.[^.]+\.(instructions|model|skills)', r'agents\.[^.]+\.localSkills\..+', r'skills\..+', r'tiers\..+', r'defaults\.model',
    r'benchmarks\..+', r'scorers\.[^.]+\.(rubric|model)',
))
_JUDGED = tuple(re.compile(p) for p in (
    r'policy\.[^.]+', r'stages\.[^.]+\.(enabled|required)', r'secrets', r'networkPolicy\..+', r'ceilings\.[^.]+',
    r'agents\.[^.]+\.(permissions\.mode|permissions\.maxTokens|tokenCeiling|enabled|secrets|mcp|memory\.[^.]+)',
    r'agents\.[^.]+\.networkPolicy\..+', r'scorers\.[^.]+\.(passingScore|enabled|selfImprovement|samplingRate)',
    r'selfImprovement\.(' + '|'.join(rules.SELF_IMPROVEMENT_DEFAULTS) + ')',
))
_NEW_AGENT_PROTECTED = re.compile(r'agents\.[^.]+\.(harness|engine|trigger)')
_MUST_STAY = tuple(re.compile(p) for p in (
    r'policy\.[^.]+', r'scorers\.[^.]+\.passingScore', r'selfImprovement\.(' + '|'.join(rules.SELF_IMPROVEMENT_DEFAULTS) + ')',
))


def _reason(code: str, path: str, message: str) -> dict:
    return {'code': code, 'path': path, 'message': message}


def _dict(value) -> dict:
    return value if isinstance(value, dict) else {}


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _kind(value) -> str:
    if isinstance(value, bool):
        return 'bool'
    if _number(value):
        return 'number'
    return type(value).__name__


def _leaves(node, prefix: str = '') -> dict[str, object]:
    """Dicts are walked; everything else is one value at its path."""
    if isinstance(node, dict) and node:
        out: dict[str, object] = {}
        for key, value in node.items():
            out.update(_leaves(value, f'{prefix}.{key}' if prefix else str(key)))
        return out
    return {prefix: node} if prefix else {}


def _rank(mode) -> int | None:
    try:
        return rules.mode_rank(mode) if isinstance(mode, str) else None
    except ValueError:
        return None


def _effective_policy(defn: dict) -> dict:
    return {**rules.POLICY_DEFAULTS, **_dict(defn.get('policy'))}


def _flags(defn: dict) -> dict[str, tuple[bool, bool, bool]]:
    """`{stage: (required, enabled, runs)}` with the effective policy. A stage runs when it is on and an enabled agent of its role exists:
    an explicit `enabled: true` with the only reviewer gone is a gate that no longer runs. Falls back to the declared stages for a
    partial definition."""
    try:
        whole = {**defn, 'policy': _effective_policy(defn), 'stages': _dict(defn.get('stages'))}
        return {stage: (bool(flag['required']), bool(flag['enabled']), bool(flag['enabled']) and bool(flag['available']))
                for stage, flag in stage_flags(whole).items()}
    except (KeyError, TypeError, AttributeError):
        stages = _dict(defn.get('stages'))
        out = {}
        for stage in rules.CONFIGURABLE_STAGES:
            explicit = _dict(stages.get(stage))
            enabled = bool(explicit.get('enabled', True))
            out[stage] = (bool(explicit.get('required')), enabled, enabled)
        return out


def _secrets(defn: dict) -> set[str]:
    found: set[str] = set()
    for name in defn.get('secrets') or []:
        if isinstance(name, str):
            found.add(name)
    for agent in _dict(defn.get('agents')).values():
        for name in _dict(agent).get('secrets') or []:
            if isinstance(name, str):
                found.add(name)
    for runner in _dict(defn.get('runners')).values():
        if isinstance(_dict(runner).get('pushSecretRef'), str):
            found.add(runner['pushSecretRef'])
    for server in _dict(defn.get('mcp')).values():
        for key in ('env', 'headers'):
            found.update(str(ref) for ref in _dict(_dict(server).get(key)).values())
    return found


def _hosts(policy: dict, key: str) -> set[str]:
    return {str(host).lower() for host in policy.get(key) or []}


def _network_widened(before, after, path: str) -> list[dict]:
    if not isinstance(before, dict) and not isinstance(after, dict):
        return []
    if isinstance(before, dict) and not isinstance(after, dict):
        return [_reason('widen_network', path, 'Removing a network policy leaves outbound access unrestricted.')]
    if not isinstance(before, dict):
        return []
    reasons = []
    if _hosts(after, 'allowedHosts') - _hosts(before, 'allowedHosts'):
        reasons.append(_reason('widen_network', f'{path}.allowedHosts', 'The proposal allows hosts the active policy does not.'))
    if _hosts(before, 'deniedHosts') - _hosts(after, 'deniedHosts'):
        reasons.append(_reason('widen_network', f'{path}.deniedHosts', 'The proposal drops a host the active policy denies.'))
    if set(after.get('extends') or []) - set(before.get('extends') or []):
        reasons.append(_reason('widen_network', f'{path}.extends', 'The proposal adds a broader network policy.'))
    return reasons


def _merge_added(before, after, path: str) -> list[dict]:
    reasons: list[dict] = []
    if isinstance(after, dict):
        base = before if isinstance(before, dict) else {}
        for key, value in after.items():
            child = f'{path}.{key}'
            if str(key).lower().replace('_', '').replace('-', '') in _MERGE_KEYS and key not in base:
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
        if text_merges(after) and not text_merges(previous):
            reasons.append(_reason('add_merge', path, 'The proposal adds a merge action. The Forja never merges.'))
    return reasons


def text_merges(text: str) -> bool:
    return len(text) > TEXT_SCAN_MAX or bool(MERGE_TEXT.search(text))


def _fields(before: dict, after: dict) -> list[dict]:
    """Removed keys, changed types and changes to fields no rule judges."""
    reasons: list[dict] = []
    old, new = _leaves(before), _leaves(after)
    old_agents, new_agents = _dict(before.get('agents')), _dict(after.get('agents'))
    old_scorers = _dict(before.get('scorers'))
    for path in sorted(old.keys() | new.keys()):
        if old.get(path) == new.get(path) and (path in old) == (path in new):
            continue
        parts = path.split('.')
        if path in old and path not in new:
            if any(rule.fullmatch(path) for rule in _MUST_STAY):
                reasons.append(_reason('remove_field', path, 'The proposal removes a field the active definition sets.'))
            continue
        if path in old and path in new and _kind(old[path]) != _kind(new[path]):
            reasons.append(_reason('invalid_type', path, 'The proposal changes the type of a field.'))
            continue
        if parts[0] == 'agents' and len(parts) > 2 and (parts[1] not in old_agents or parts[1] not in new_agents):
            if parts[1] not in old_agents and _NEW_AGENT_PROTECTED.fullmatch(path):
                reasons.append(_reason('protected_field', path, 'A new agent cannot bring a runtime or a trigger.'))
            continue  # a whole agent added or removed: the agent and stage rules judge it
        if parts[0] == 'scorers' and len(parts) > 2 and parts[1] not in old_scorers:
            continue  # a new scorer only scores more
        if any(rule.fullmatch(path) for rule in _FREE + _JUDGED):
            continue
        reasons.append(_reason('protected_field', path, 'This field is not one a proposal may change. A person edits it in the definition.'))
    return reasons


def _policy_rules(before: dict, after: dict) -> list[dict]:
    reasons: list[dict] = []
    old, new = _effective_policy(before), _effective_policy(after)
    if old['requireSpec'] is True and new['requireSpec'] is not True:
        reasons.append(_reason('weaken_gate', 'policy.requireSpec', 'A spec would no longer be required.'))
    for key, ranks in (('specApproval', _SPEC), ('reviewIndependence', _INDEPENDENCE)):
        if new[key] not in ranks:
            reasons.append(_reason('invalid_type', f'policy.{key}', 'The value is not one the Forja knows.'))
        elif ranks[new[key]] < ranks.get(old[key], max(ranks.values())):
            reasons.append(_reason('weaken_gate', f'policy.{key}', 'The gate would be less strict than it is now.'))
    if not _number(new['maxReviewReturns']):
        reasons.append(_reason('invalid_type', 'policy.maxReviewReturns', 'The value must be a number.'))
    elif _number(old['maxReviewReturns']) and new['maxReviewReturns'] > old['maxReviewReturns']:
        reasons.append(_reason('weaken_gate', 'policy.maxReviewReturns', 'More returns would be allowed before the gate holds.'))
    old_rank, new_rank = _rank(old['maxPermissionMode']), _rank(new['maxPermissionMode'])
    if new_rank is None:
        reasons.append(_reason('raise_permission', 'policy.maxPermissionMode', 'The permission mode is not one the Forja knows.'))
    elif new_rank > (old_rank if old_rank is not None else 0):
        reasons.append(_reason('raise_permission', 'policy.maxPermissionMode', 'The highest permission mode would go up.'))
    old_flags, new_flags = _flags(before), _flags(after)
    for stage in rules.CONFIGURABLE_STAGES:
        (old_required, old_enabled, old_runs), (new_required, new_enabled, new_runs) = old_flags[stage], new_flags[stage]
        if old_required and not new_required:
            reasons.append(_reason('weaken_gate', f'stages.{stage}', f'The {stage} gate would no longer be required.'))
        if (old_enabled and not new_enabled) or (old_runs and not new_runs):
            reasons.append(_reason('weaken_gate', f'stages.{stage}', f'The {stage} gate would be turned off.'))
    return reasons


def _ceiling(old, new, path: str) -> list[dict]:
    if _number(old) and not (_number(new) and new <= old):
        return [_reason('raise_ceiling', path, 'A ceiling would go up or go away.')]
    return []


def _agent_rules(before: dict, after: dict) -> list[dict]:
    reasons: list[dict] = []
    ceiling = _rank(_effective_policy(before)['maxPermissionMode'])
    ceiling = ceiling if ceiling is not None else 0
    old_agents = _dict(before.get('agents'))
    for name, agent in _dict(after.get('agents')).items():
        agent, previous = _dict(agent), old_agents.get(name)
        where = f'agents.{name}'
        mode = _dict(agent.get('permissions')).get('mode', rules.DEFAULT_MODE)
        rank = _rank(mode)
        if rank is None:
            reasons.append(_reason('raise_permission', f'{where}.permissions.mode', 'The permission mode is not one the Forja knows.'))
            continue
        if not isinstance(previous, dict):
            if rank > ceiling:
                reasons.append(_reason('raise_permission', f'{where}.permissions.mode', 'A new agent would be allowed more than the active limit.'))
            if isinstance(agent.get('networkPolicy'), dict):
                reasons.extend(_network_widened(before.get('networkPolicy') if isinstance(before.get('networkPolicy'), dict) else {},
                                                agent['networkPolicy'], f'{where}.networkPolicy'))
            if agent.get('mcp'):
                reasons.append(_reason('protected_field', f'{where}.mcp', 'A new agent cannot bring MCP servers.'))
            continue
        old_rank = _rank(_dict(previous.get('permissions')).get('mode', rules.DEFAULT_MODE))
        if rank > (old_rank if old_rank is not None else 0):
            reasons.append(_reason('raise_permission', f'{where}.permissions.mode', 'An agent would be allowed to do more.'))
        reasons.extend(_network_widened(previous.get('networkPolicy'), agent.get('networkPolicy'), f'{where}.networkPolicy'))
        if previous.get('enabled') is False and agent.get('enabled', True) is not False:
            reasons.append(_reason('protected_field', f'{where}.enabled', 'Turning an agent back on is a change a person makes.'))
        if set(agent.get('mcp') or []) - set(previous.get('mcp') or []):
            reasons.append(_reason('protected_field', f'{where}.mcp', 'The proposal gives an agent an MCP server it does not have.'))
        reasons.extend(_ceiling(previous.get('tokenCeiling'), agent.get('tokenCeiling'), f'{where}.tokenCeiling'))
        reasons.extend(_ceiling(_dict(previous.get('permissions')).get('maxTokens'), _dict(agent.get('permissions')).get('maxTokens'),
                                f'{where}.permissions.maxTokens'))
        for key, value in _dict(previous.get('memory')).items():
            reasons.extend(_ceiling(value, _dict(agent.get('memory')).get(key), f'{where}.memory.{key}'))
    return reasons


def _scorer_rules(before: dict, after: dict) -> list[dict]:
    reasons: list[dict] = []
    new_scorers = _dict(after.get('scorers'))
    for name, scorer in _dict(before.get('scorers')).items():
        if not isinstance(scorer, dict):
            continue
        if not isinstance(new_scorers.get(name), dict):
            reasons.append(_reason('remove_scorer', f'scorers.{name}', 'The proposal removes a scorer.'))
            continue
        old, new = {**rules.SCORER_DEFAULTS, **scorer}, {**rules.SCORER_DEFAULTS, **new_scorers[name]}
        if old['enabled'] and new['enabled'] is not True:
            reasons.append(_reason('disable_scorer', f'scorers.{name}.enabled', 'The proposal turns a scorer off.'))
        if old['selfImprovement'] and new['selfImprovement'] is not True:
            reasons.append(_reason('disable_scorer', f'scorers.{name}.selfImprovement', 'The proposal stops a scorer from feeding improvement.'))
        if _number(old['samplingRate']) and not (_number(new['samplingRate']) and new['samplingRate'] >= old['samplingRate']):
            reasons.append(_reason('loosen_trial', f'scorers.{name}.samplingRate', 'The scorer would look at fewer runs.'))
        if _number(old.get('passingScore')) and _number(new.get('passingScore')) and new['passingScore'] < old['passingScore']:
            reasons.append(_reason('lower_threshold', f'scorers.{name}.passingScore', 'The pass line would be lower.'))
    return reasons


def _trial_rules(before: dict, after: dict) -> list[dict]:
    reasons: list[dict] = []
    old = {**rules.SELF_IMPROVEMENT_DEFAULTS, **_dict(before.get('selfImprovement'))}
    new = {**rules.SELF_IMPROVEMENT_DEFAULTS, **_dict(after.get('selfImprovement'))}
    for key in rules.SELF_IMPROVEMENT_DEFAULTS:
        if not _number(new[key]):
            reasons.append(_reason('invalid_type', f'selfImprovement.{key}', 'The value must be a number.'))
        elif _number(old[key]) and ((key in _LOOSER_IF_HIGHER and new[key] > old[key]) or (key in _LOOSER_IF_LOWER and new[key] < old[key])):
            reasons.append(_reason('loosen_trial', f'selfImprovement.{key}', 'The trial would be less careful than it is now.'))
    for key in ('tokensPerWorkItem', 'tokensPerRun'):
        reasons.extend(_ceiling(_dict(before.get('ceilings')).get(key), _dict(after.get('ceilings')).get(key), f'ceilings.{key}'))
    return reasons


def check(before: dict, after: dict) -> list[dict]:
    """Reasons the proposal cannot be shown to a person. Empty means it may be reviewed."""
    if not isinstance(before, dict) or not isinstance(after, dict):
        return [_reason('invalid_type', '$', 'A definition is a mapping.')]
    reasons = _fields(before, after) + _policy_rules(before, after) + _agent_rules(before, after) + _scorer_rules(before, after)
    reasons += _trial_rules(before, after)
    if _secrets(after) - _secrets(before):
        reasons.append(_reason('add_secret', 'secrets', 'The proposal grants a secret the active definition does not.'))
    reasons.extend(_network_widened(before.get('networkPolicy'), after.get('networkPolicy'), 'networkPolicy'))
    reasons.extend(_merge_added(before, after, '$'))
    unique: dict[tuple[str, str], dict] = {}
    for reason in reasons:
        unique.setdefault((reason['code'], reason['path']), reason)
    return list(unique.values())
