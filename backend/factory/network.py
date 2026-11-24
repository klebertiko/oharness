"""Outbound network policy. A named host is allowed only when the policy says so; a denial wins.

The check happens before the command runs, so a refused host never starts. It fails closed: a host is found in a URL of any
scheme (with or without a user, port or trailing dot), in the `user@host` and `user@host:path` forms ssh, scp and git use, and,
for the programs that talk to the network, in a bare host name or IPv4 address. A policy that extends a named policy the
definition does not have refuses every host. A command that names no host is local and is not judged here.
"""
from __future__ import annotations

import re

_LABEL = re.compile(r'[a-z0-9-]{1,63}')
_IPV4 = re.compile(r'(?:\d{1,3}\.){3}\d{1,3}')
_USER_AT = re.compile(r'[A-Za-z0-9._~+-]{1,64}@')
# Programs whose bare arguments may be hosts. For any other program only a URL or a user@host form counts.
NETWORK_PROGRAMS = frozenset({'curl', 'wget', 'ssh', 'scp', 'sftp', 'rsync', 'nc', 'ncat', 'netcat', 'telnet', 'ftp', 'ping', 'http',
                              'https', 'git', 'nslookup', 'dig', 'host'})


def policy_for(definition: dict, agent_id: str) -> dict:
    agents = definition.get('agents') or {}
    agent = agents.get(agent_id) or {}
    base = definition.get('networkPolicy') or {}
    own = agent.get('networkPolicy') or {}
    named = definition.get('networkPolicies') or {}
    allowed: list[str] = []
    denied: list[str] = []
    missing: list[str] = []
    for source in (base, own):
        for ref in source.get('extends') or []:
            extra = named.get(ref)
            if not isinstance(extra, dict):
                missing.append(str(ref))
                continue
            allowed.extend(extra.get('allowedHosts') or [])
            denied.extend(extra.get('deniedHosts') or [])
        allowed.extend(source.get('allowedHosts') or [])
        denied.extend(source.get('deniedHosts') or [])
    return {'allowedHosts': [_clean(h) for h in allowed], 'deniedHosts': [_clean(h) for h in denied], 'missing': missing}


def _is_hostname(text: str) -> bool:
    """Two or more dot-separated labels, the last one starting with a letter. Checked label by label, in linear time."""
    labels = text.split('.')
    if len(text) > 253 or len(labels) < 2:
        return False
    if not all(_LABEL.fullmatch(label) and not label.startswith('-') and not label.endswith('-') for label in labels):
        return False
    return labels[-1][0].isalpha()


def _clean(host: str) -> str:
    return str(host).strip().lower().rstrip('.')


def _authority_host(authority: str) -> str:
    """`user:pass@host:port` → `host`; `[::1]:80` → `::1`."""
    host = authority.rsplit('@', 1)[-1]
    if host.startswith('['):
        return host[1:].split(']', 1)[0]
    return host.split(':', 1)[0]


def _hosts_in_word(word: str, network_program: bool) -> list[str]:
    if '://' in word:
        rest = word.split('://', 1)[1]
        authority = re.split(r'[/?#]', rest, maxsplit=1)[0]
        host = _clean(_authority_host(authority))
        return [host] if host else []
    if not word.startswith('-') and (at := _USER_AT.match(word)):
        host = _clean(re.split(r'[:/]', word[at.end():], maxsplit=1)[0])
        return [host] if host and (_is_hostname(host) or _IPV4.fullmatch(host) or network_program) else []
    if network_program and not word.startswith('-'):
        candidate = _clean(re.split(r'[:/]', word, maxsplit=1)[0])
        if _is_hostname(candidate) or _IPV4.fullmatch(candidate):
            return [candidate]
    return []


def hosts_in(argv: list[str]) -> list[str]:
    program = re.split(r'[\\/]', str(argv[0]))[-1].lower().removesuffix('.exe') if argv else ''
    network_program = program in NETWORK_PROGRAMS
    found: list[str] = []
    for word in argv[1:] if argv else []:
        found.extend(_hosts_in_word(str(word), network_program))
    return found


def verdict(policy: dict, host: str) -> str | None:
    host = _clean(host)
    if policy.get('missing'):
        return f'The network policy extends {policy["missing"][0]}, which this definition does not have, so no host is allowed.'
    if host in policy['deniedHosts']:
        return f'The network policy denies {host}.'
    allowed = policy['allowedHosts']
    if allowed and host not in allowed:
        return f'The network policy does not allow {host}.'
    return None


def command_denied(definition: dict, agent_id: str, argv: list[str]) -> str | None:
    policy = policy_for(definition, agent_id)
    if not policy['allowedHosts'] and not policy['deniedHosts'] and not policy['missing']:
        return None
    for host in hosts_in(argv):
        reason = verdict(policy, host)
        if reason:
            return reason
    return None
