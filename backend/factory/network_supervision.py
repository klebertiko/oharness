"""Approval of commands without OS network isolation. Approval is consent, not confinement.

Only a live run can consume a decision. Reusable consent covers a single canonical host
on the small curl grammar below; scripts, redirects and MCP always need a fresh decision.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
import weakref
from dataclasses import dataclass
from urllib.parse import urlsplit

from factory import network


@dataclass(frozen=True)
class Decision:
    required: bool
    hosts: tuple[str, ...] = ()
    blocked: str | None = None
    remember_host: str | None = None
    isolation: str = 'none'
    reason: str = 'This command may access the network. OS network isolation is unavailable.'


def classify(definition: dict, agent_id: str, argv: list[str], *, kind: str = 'command') -> Decision:
    policy = network.policy_for(definition, agent_id)
    hosts = tuple(dict.fromkeys(network.hosts_in(argv)))
    if policy['missing']:
        return Decision(True, hosts, blocked=network.verdict(policy, ''))
    for host in hosts:
        if reason := network.verdict(policy, host):
            return Decision(True, hosts, blocked=reason)
    # Version diagnostics do not load repository configuration or run hooks/aliases.
    local = kind == 'command' and argv in (['git', '--version'], ['git', 'version'])
    host = None
    # --disable must be the first curl option: no .curlrc, proxy, redirects or config.
    if kind == 'command' and len(argv) == 3 and argv[:2] == ['curl', '--disable']:
        try:
            parsed = urlsplit(argv[2])
        except ValueError:
            parsed = None
        if (parsed is not None and parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password
                and not network.unreadable(argv) and not network.redirects(argv) and len(hosts) == 1):
            host = hosts[0]
    return Decision(not local, hosts, remember_host=host)


def policy_key(definition: dict, agent_id: str) -> str:
    # Changes to any part of the factory revoke remembered consent, including agent identity.
    body = json.dumps({'definition': definition, 'agent': agent_id}, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(body.encode()).hexdigest()


@dataclass
class Pending:
    supervisor: Supervisor
    request: dict
    future: asyncio.Future
    claimed: bool = False


_pending: dict[str, Pending] = {}
_supervisors: weakref.WeakSet = weakref.WeakSet()


def pending(item_id: str, request_id: str) -> Pending:
    found = _pending.get(request_id)
    if (found is None or found.supervisor.item_id != item_id or found.future.done() or found.claimed
            or found.supervisor.cancel.is_set()):
        raise ValueError('This network approval has expired. Start the run again.')
    return found


def resolve(item_id: str, request_id: str, decision: str) -> None:
    found = pending(item_id, request_id)
    if decision not in ('once', 'host', 'deny'):
        raise ValueError('Unknown network decision.')
    if decision == 'host' and not found.request['can_remember']:
        raise ValueError('An opaque command cannot be approved for a host.')
    if decision == 'host':
        found.supervisor.grants.add(found.request['hosts'][0])
    found.future.set_result(decision != 'deny')


def item_network(item_id: str) -> dict:
    found = next((p for p in _pending.values() if p.supervisor.item_id == item_id
                  and not p.future.done() and not p.supervisor.cancel.is_set()), None)
    return {'isolation': 'none', 'mode': 'supervised', 'pending': found.request if found else None}


def cancel_for_item(item_id: str) -> None:
    for supervisor in list(_supervisors):
        if supervisor.item_id == item_id and not supervisor.loop.is_closed():
            supervisor.loop.call_soon_threadsafe(supervisor.cancel.set)


class Supervisor:
    def __init__(self, run_id: str, item_id: str, definition: dict, agent_id: str, checkpoint,
                 *, cancel: asyncio.Event | None = None, grants: set[str] | None = None, scrub=None, audit=None):
        self.run_id, self.item_id, self.agent_id = run_id, item_id, agent_id
        self.definition = json.loads(json.dumps(definition))
        self.key = policy_key(self.definition, agent_id)
        self.checkpoint = checkpoint
        self.cancel = cancel or asyncio.Event()
        self.grants = set(grants or ())
        self.scrub = scrub or (lambda value: value)
        self.audit = audit
        self.loop = asyncio.get_running_loop()
        _supervisors.add(self)

    def close(self):
        _supervisors.discard(self)

    async def _record(self, argv, kind, source):
        if self.audit is not None:
            await self.audit('network_access_approved', self.scrub({
                'run_id': self.run_id, 'agent_id': self.agent_id, 'argv': list(argv),
                'hosts': network.hosts_in(argv), 'kind': kind, 'source': source, 'isolation': 'none', 'policy_key': self.key,
            }))

    async def authorize(self, argv: list[str], *, kind: str = 'command') -> bool:
        if self.cancel.is_set():
            return False
        decision = classify(self.definition, self.agent_id, argv, kind=kind)
        if decision.blocked:
            return False
        if not decision.required:
            return True
        if decision.remember_host in self.grants:
            await self._record(argv, kind, 'host-grant')
            return not self.cancel.is_set()
        request_id = str(uuid.uuid4())
        request = self.scrub({'id': request_id, 'run_id': self.run_id, 'argv': list(argv), 'hosts': list(decision.hosts),
                             'reason': decision.reason, 'can_remember': decision.remember_host is not None})
        future = asyncio.get_running_loop().create_future()
        _pending[request_id] = Pending(self, request, future)
        stopped = asyncio.create_task(self.cancel.wait())
        approved = False
        try:
            await self.checkpoint(request)
            await asyncio.wait((future, stopped), return_when=asyncio.FIRST_COMPLETED)
            approved = not self.cancel.is_set() and future.done() and not future.cancelled() and bool(future.result())
        finally:
            _pending.pop(request_id, None)
            stopped.cancel()
            await asyncio.gather(stopped, return_exceptions=True)
            if not future.done():
                future.cancel()
        if approved and not self.cancel.is_set():
            await self._record(argv, kind, 'human-decision')
        return approved and not self.cancel.is_set()
