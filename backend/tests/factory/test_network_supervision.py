"""Human supervision covers opaque commands and MCP without claiming OS isolation."""
import asyncio

import anyio
import pytest

from factory import network_supervision as supervision


def definition():
    return {'name': 'app', 'agents': {'builder': {}}, 'repositories': [{'protectedBranches': ['main']}],
            'networkPolicy': {'allowedHosts': ['api.example.com'], 'deniedHosts': ['blocked.example.com']}}


@pytest.mark.parametrize('argv', [
    ['python', 'script.py'], ['npm', 'install'], ['sh', '-c', 'echo hello'],
    ['curl', '--disable', 'https://api.example.com'], ['git', 'status'],
])
def test_network_and_unproven_commands_require_a_person(argv):
    decision = supervision.classify(definition(), 'builder', argv)
    assert decision.required
    assert decision.isolation == 'none'


def test_explicit_denials_stay_denied_and_host_grants_never_cover_scripts():
    assert supervision.classify(definition(), 'builder', ['curl', '--disable', 'https://blocked.example.com']).blocked
    assert supervision.classify(definition(), 'builder', ['python', 'script.py', 'https://api.example.com']).remember_host is None
    assert supervision.classify(definition(), 'builder', ['curl', '--disable', 'https://api.example.com']).remember_host == 'api.example.com'
    assert supervision.classify(definition(), 'builder', ['curl', '--disable', '-L', 'https://api.example.com']).remember_host is None


def test_local_diagnostic_does_not_pause_but_mcp_always_does():
    assert not supervision.classify(definition(), 'builder', ['git', '--version']).required
    assert supervision.classify(definition(), 'builder', ['git', '--version'], kind='mcp').required


def test_only_exact_pending_request_can_resume_and_once_does_not_repeat():
    async def case():
        asked = asyncio.Queue()
        async def checkpoint(request):
            await asked.put(request)
        gate = supervision.Supervisor('run-1', 'item-1', definition(), 'builder', checkpoint)
        task = asyncio.create_task(gate.authorize(['python', 'script.py']))
        request = await asyncio.wait_for(asked.get(), 1)
        assert not task.done()
        assert supervision.item_network('item-1')['pending']['id'] == request['id']
        with pytest.raises(ValueError):
            supervision.pending('another-item', request['id'])
        supervision.resolve('item-1', request['id'], 'once')
        assert await task is True
        assert supervision.item_network('item-1')['pending'] is None
        again = asyncio.create_task(gate.authorize(['python', 'script.py']))
        second = await asyncio.wait_for(asked.get(), 1)
        assert second['id'] != request['id'] and not again.done()
        supervision.resolve('item-1', second['id'], 'deny')
        assert await again is False
    anyio.run(case)


def test_stop_invalidates_pending_and_prevents_late_approval():
    async def case():
        asked, cancel = asyncio.Queue(), asyncio.Event()
        async def checkpoint(request):
            await asked.put(request)
        gate = supervision.Supervisor('run', 'item', definition(), 'builder', checkpoint, cancel=cancel)
        task = asyncio.create_task(gate.authorize(['node', 'script.js']))
        request = await asyncio.wait_for(asked.get(), 1)
        cancel.set()
        assert await asyncio.wait_for(task, 1) is False
        with pytest.raises(ValueError):
            supervision.resolve('item', request['id'], 'once')
    anyio.run(case)


def test_host_grant_is_scoped_to_policy_and_only_simple_recognized_commands():
    async def case():
        asked = asyncio.Queue()
        async def checkpoint(request):
            await asked.put(request)
        gate = supervision.Supervisor('run', 'item', definition(), 'builder', checkpoint)
        argv = ['curl', '--disable', 'https://api.example.com']
        task = asyncio.create_task(gate.authorize(argv))
        request = await asyncio.wait_for(asked.get(), 1)
        supervision.resolve('item', request['id'], 'host')
        assert await task
        assert await asyncio.wait_for(gate.authorize(argv), 1)
        opaque = asyncio.create_task(gate.authorize(['python', 'script.py', argv[-1]]))
        request = await asyncio.wait_for(asked.get(), 1)
        assert not opaque.done() and not request['can_remember']
        with pytest.raises(ValueError):
            supervision.resolve('item', request['id'], 'host')
        supervision.resolve('item', request['id'], 'deny')
        assert not await opaque
    anyio.run(case)


def test_stage_tool_never_executes_opaque_command_without_approval(monkeypatch):
    from factory import runner
    from factory.dispatch import StageRun
    calls, journal = [], []
    class Writer:
        async def append(self, event):
            journal.append(event)
    async def execute(*args, **kwargs):
        calls.append(args[2])
        return {'ok': True, 'result': 'done'}
    monkeypatch.setattr(runner, 'run_as_agent', execute)
    async def case():
        asked = asyncio.Queue()
        async def checkpoint(request):
            await asked.put(request)
        gate = supervision.Supervisor('run', 'item', definition(), 'builder', checkpoint)
        run = StageRun(run_id='run', item_id='item', stage='implement', agent_id='builder', workspace={},
                       definition=definition(), store=None, redactor=runner.RunRedactor([]), writer=Writer(), limit=100,
                       supervisor=gate)
        task = asyncio.create_task(run.tool(['python', 'script.py']))
        request = await asyncio.wait_for(asked.get(), 1)
        assert calls == []
        supervision.resolve('item', request['id'], 'once')
        assert (await task)['ok']
        assert calls == [['python', 'script.py']]
    anyio.run(case)


def test_stop_during_approval_cleanup_never_authorizes_mcp():
    async def case():
        asked, cancel = asyncio.Queue(), asyncio.Event()
        async def checkpoint(request):
            await asked.put(request)
        gate = supervision.Supervisor('run', 'item', definition(), 'builder', checkpoint, cancel=cancel)
        task = asyncio.create_task(gate.authorize(['node', 'server.js'], kind='mcp'))
        request = await asked.get()
        supervision.resolve('item', request['id'], 'once')
        while request['id'] in supervision._pending:
            await asyncio.sleep(0)
        cancel.set()
        assert not await task
    anyio.run(case)


def test_cancellation_from_another_thread_wakes_the_waiting_run():
    async def case():
        asyncio.get_running_loop().set_debug(True)
        asked = asyncio.Queue()
        async def checkpoint(request):
            await asked.put(request)
        gate = supervision.Supervisor('run', 'item', definition(), 'builder', checkpoint)
        task = asyncio.create_task(gate.authorize(['python', 'script.py']))
        await asked.get()
        await asyncio.to_thread(supervision.cancel_for_item, 'item')
        assert not await asyncio.wait_for(task, 1)
    anyio.run(case)


@pytest.mark.parametrize('remembered', [False, True])
def test_item_cancel_during_access_audit_prevents_execution(remembered):
    async def case():
        asked, auditing, release = asyncio.Queue(), asyncio.Event(), asyncio.Event()
        async def checkpoint(request):
            await asked.put(request)
        async def audit(*args):
            auditing.set()
            await release.wait()
        gate = supervision.Supervisor('run', 'item', definition(), 'builder', checkpoint, audit=audit,
                                      grants={'api.example.com'} if remembered else set())
        task = asyncio.create_task(gate.authorize(['curl', '--disable', 'https://api.example.com']))
        if not remembered:
            request = await asked.get()
            supervision.resolve('item', request['id'], 'once')
        await auditing.wait()
        supervision.cancel_for_item('item')
        await asyncio.sleep(0)
        release.set()
        assert not await task
    anyio.run(case)


def test_cancelled_mcp_raises_run_stopped_without_starting_transport():
    from factory import agent_mcp
    from factory.dispatch import RunStopped
    async def case():
        asked = asyncio.Queue()
        async def checkpoint(request):
            await asked.put(request)
        body = definition()
        body['agents']['builder']['mcp'] = ['server']
        body['mcp'] = {'server': {'command': 'node', 'args': ['server.js']}}
        gate = supervision.Supervisor('run', 'item', body, 'builder', checkpoint)
        task = asyncio.create_task(agent_mcp.tools_for(body, 'builder', supervisor=gate))
        await asked.get()
        supervision.cancel_for_item('item')
        with pytest.raises(RunStopped):
            await task
    anyio.run(case)
