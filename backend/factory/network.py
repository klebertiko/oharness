"""Outbound network policy. A named host is allowed only when the policy says so; a denial wins.

A command with no host is local and is not judged here. The check happens before the command runs, so a refused host never starts.
"""
from __future__ import annotations

import re

_URL_HOST = re.compile(r'https?://([^/\s:?#]+)', re.IGNORECASE)


def policy_for(definition: dict, agent_id: str) -> dict:
    agents = definition.get('agents') or {}
    agent = agents.get(agent_id) or {}
    base = definition.get('networkPolicy') or {}
    own = agent.get('networkPolicy') or {}
    named = definition.get('networkPolicies') or {}
    allowed: list[str] = []
    denied: list[str] = []
    for source in (base, own):
        for ref in source.get('extends') or []:
            extra = named.get(ref) or {}
            allowed.extend(extra.get('allowedHosts') or [])
            denied.extend(extra.get('deniedHosts') or [])
        allowed.extend(source.get('allowedHosts') or [])
        denied.extend(source.get('deniedHosts') or [])
    return {'allowedHosts': [h.lower() for h in allowed], 'deniedHosts': [h.lower() for h in denied]}


def hosts_in(argv: list[str]) -> list[str]:
    found = []
    for word in argv:
        for match in _URL_HOST.finditer(str(word)):
            found.append(match.group(1).lower().rstrip('.'))
    return found


def verdict(policy: dict, host: str) -> str | None:
    host = host.lower().rstrip('.')
    if host in policy['deniedHosts']:
        return f'The network policy denies {host}.'
    allowed = policy['allowedHosts']
    if allowed and host not in allowed:
        return f'The network policy does not allow {host}.'
    return None


def command_denied(definition: dict, agent_id: str, argv: list[str]) -> str | None:
    policy = policy_for(definition, agent_id)
    if not policy['allowedHosts'] and not policy['deniedHosts']:
        return None
    for host in hosts_in(argv):
        reason = verdict(policy, host)
        if reason:
            return reason
    return None
