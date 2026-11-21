"""MCP client for one agent. It speaks JSON-RPC over a transport: initialize, then tools/list.

The transport is a process speaking the protocol, or a stand-in a test registers. Tool names come back; secret values do not,
because the run journal redacts them after this returns.
"""
from __future__ import annotations

import asyncio
import json

from factory.runner import RunnerError

PROTOCOL = '2024-11-05'
_overrides: dict[str, object] = {}


def use(server_id: str, transport) -> None:
    _overrides[server_id] = transport


def clear() -> None:
    _overrides.clear()


class MemoryTransport:
    """An in-process server. `handler(method, params)` returns the JSON-RPC result object."""

    def __init__(self, handler):
        self.handler = handler
        self.calls: list[str] = []

    async def request(self, method: str, params: dict) -> dict:
        self.calls.append(method)
        return self.handler(method, params)

    async def close(self) -> None:
        return None


class StdioTransport:
    """A real process. One JSON object per line, in and out."""

    def __init__(self, command: str, args: list[str]):
        self.command, self.args = command, list(args)
        self.proc = None
        self._next = 0

    async def request(self, method: str, params: dict) -> dict:
        if self.proc is None:
            self.proc = await asyncio.create_subprocess_exec(
                self.command, *self.args, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE)
        self._next += 1
        if self.proc.stdin is None or self.proc.stdout is None:
            raise RunnerError('the MCP process has no pipes')
        body = json.dumps({'jsonrpc': '2.0', 'id': self._next, 'method': method, 'params': params}) + '\n'
        self.proc.stdin.write(body.encode())
        await self.proc.stdin.drain()
        line = await self.proc.stdout.readline()
        if not line:
            raise RunnerError('the MCP process closed')
        return json.loads(line)

    async def close(self) -> None:
        if self.proc is not None and self.proc.returncode is None:
            self.proc.terminate()
            await self.proc.wait()


async def list_tools(transport) -> list[str]:
    await transport.request('initialize', {'protocolVersion': PROTOCOL, 'capabilities': {}, 'clientInfo': {'name': 'forja', 'version': '1'}})
    listed = await transport.request('tools/list', {})
    tools = (listed.get('result') or {}).get('tools') or []
    return [str(tool['name']) for tool in tools if isinstance(tool, dict) and isinstance(tool.get('name'), str)]


def _open(server: dict):
    command = server.get('command')
    if not isinstance(command, str) or not command:
        raise RunnerError('this MCP server has no command')
    args = [str(arg) for arg in server.get('args') or []]
    return StdioTransport(command, args)


async def tools_for(definition: dict, agent_id: str) -> list[str]:
    agent = (definition.get('agents') or {}).get(agent_id) or {}
    names: list[str] = []
    for server_id in agent.get('mcp') or []:
        server = (definition.get('mcp') or {}).get(server_id)
        if not isinstance(server, dict):
            raise RunnerError(f'the MCP server {server_id} is not in the definition')
        transport = _overrides.get(server_id) or _open(server)
        try:
            names.extend(await list_tools(transport))
        finally:
            await transport.close()
    return names
