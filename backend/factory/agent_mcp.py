"""MCP client for one agent. It speaks JSON-RPC over a transport: initialize, then tools/list.

The transport is a process speaking the protocol, or a stand-in a test registers. A process runs through the sandbox executor,
like every agent command: a clean environment (never the sidecar's), a fixed working folder, a time limit, an output limit and the
whole process tree stopped at the end. The requests go in at once on stdin and the answers are matched by id, so a server that
answers another request, or never answers, is refused. Tool names come back bounded; secret values do not, because the run
journal redacts them after this returns.
"""
from __future__ import annotations

import json
import re
import tempfile
from pathlib import Path

from factory.runner import RunnerError
from sandbox import exec as sandbox_exec

PROTOCOL = '2024-11-05'
REQUEST_TIMEOUT_S = 20
MAX_TOOLS = 200
_TOOL_NAME = re.compile(r'[A-Za-z0-9_.:-]{1,100}')
_overrides: dict[str, object] = {}


def use(server_id: str, transport) -> None:
    _overrides[server_id] = transport


def clear() -> None:
    _overrides.clear()


def _requests() -> list[dict]:
    return [
        {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
         'params': {'protocolVersion': PROTOCOL, 'capabilities': {}, 'clientInfo': {'name': 'forja', 'version': '1'}}},
        {'jsonrpc': '2.0', 'method': 'notifications/initialized', 'params': {}},
        {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}},
    ]


class MemoryTransport:
    """An in-process server. `handler(method, params)` returns the JSON-RPC answer. `check_ids` makes it as strict as a process."""

    def __init__(self, handler, *, check_ids: bool = False):
        self.handler = handler
        self.check_ids = check_ids
        self.calls: list[str] = []

    async def exchange(self, requests: list[dict]) -> dict[int, dict]:
        answers: dict[int, dict] = {}
        for request in requests:
            if 'id' not in request:
                continue
            self.calls.append(request['method'])
            answer = self.handler(request['method'], request['params'])
            key = answer.get('id') if self.check_ids else request['id']
            if isinstance(key, int):
                answers[key] = answer
        return answers

    async def close(self) -> None:
        return None


class StdioTransport:
    """A real process, run once through the sandbox executor with the requests on stdin."""

    def __init__(self, command: str, args: list[str]):
        self.command, self.args = command, list(args)

    async def exchange(self, requests: list[dict]) -> dict[int, dict]:
        stdin = ''.join(json.dumps(request) + '\n' for request in requests).encode()
        with tempfile.TemporaryDirectory(prefix='forja-mcp-') as folder:
            try:
                result = await sandbox_exec.run([self.command, *self.args], Path(folder), REQUEST_TIMEOUT_S, None, stdin_data=stdin,
                                                reap_descendants=True, redact_output=False)
            except (OSError, sandbox_exec.ProgramNotFound) as exc:
                raise RunnerError('the MCP server could not start') from exc
        if result.get('timed_out'):
            raise RunnerError('the MCP server did not answer in time')
        answers: dict[int, dict] = {}
        for line in str(result.get('result') or '').splitlines():
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(message, dict) and isinstance(message.get('id'), int):
                answers.setdefault(message['id'], message)
        return answers

    async def close(self) -> None:
        return None


async def list_tools(transport) -> list[str]:
    answers = await transport.exchange(_requests())
    for request_id in (1, 2):
        answer = answers.get(request_id)
        if not isinstance(answer, dict) or 'error' in answer or not isinstance(answer.get('result'), dict):
            raise RunnerError('the MCP server did not answer the request it was asked')
    tools = answers[2]['result'].get('tools') or []
    names = [tool['name'] for tool in tools if isinstance(tool, dict) and isinstance(tool.get('name'), str) and _TOOL_NAME.fullmatch(tool['name'])]
    return names[:MAX_TOOLS]


def _open(server: dict):
    command = server.get('command')
    if not isinstance(command, str) or not command:
        raise RunnerError('this MCP server has no command')
    args = [str(arg) for arg in server.get('args') or []]
    return StdioTransport(command, args)


async def tools_for(definition: dict, agent_id: str, *, supervisor=None) -> list[str]:
    agent = (definition.get('agents') or {}).get(agent_id) or {}
    names: list[str] = []
    for server_id in agent.get('mcp') or []:
        server = (definition.get('mcp') or {}).get(server_id)
        if not isinstance(server, dict):
            raise RunnerError(f'the MCP server {server_id} is not in the definition')
        if server_id not in _overrides:
            argv = [str(server.get('command') or ''), *[str(arg) for arg in server.get('args') or []]]
            from factory.runner import deny_command
            if reason := deny_command(argv, [b for repo in definition.get('repositories', []) for b in repo['protectedBranches']]):
                raise RunnerError(reason)
            if supervisor is None or not await supervisor.authorize(argv, kind='mcp'):
                if supervisor is not None and supervisor.cancel.is_set():
                    from factory.dispatch import RunStopped
                    raise RunStopped('The run was stopped before its MCP server started.')
                raise RunnerError('The MCP server needs human network approval; it did not start.')
        transport = _overrides.get(server_id) or _open(server)
        try:
            if supervisor is not None and supervisor.cancel.is_set():
                from factory.dispatch import RunStopped
                raise RunStopped('The run was stopped before its MCP server started.')
            names.extend(await list_tools(transport))
        finally:
            await transport.close()
    return names[:MAX_TOOLS]
