"""#166: subagent children run beside the parent, report state live, and cancel one at a time."""
import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from adapters.base import AdapterConfig, AgentAdapter
from engine import RUNS, RunControl
from main import app
from sandbox.broker import ToolBroker
from sandbox.schemas import TOOL_SCHEMAS, ToolsRequest
from sandbox.subagents import SUBAGENT_RULES, SubagentGroup, subagent_schema


class Scripted(AgentAdapter):
    """Parent turns come from `turns`; a child answers `child_text(task)` after waiting on its gate."""

    def __init__(self, turns, gates=None):
        self.turns = list(turns)
        self.gates = gates or {}
        self.child_tasks = []

    async def invoke(self, prompt, config):
        raise AssertionError

    async def stream(self, prompt, config):
        yield ''

    async def stream_events(self, prompt, config):
        self.child_tasks.append(prompt)
        gate = self.gates.get(prompt)
        yield {'kind': 'text', 'text': f'start {prompt}. '}
        if gate:
            await gate.wait()
        yield {'kind': 'text', 'text': f'result of {prompt}'}
        yield {'kind': 'usage', 'tokens': 11}

    async def stream_turn(self, messages, config, tools=None):
        turn = self.turns.pop(0)
        if turn.get('calls'):
            yield {'kind': 'tool_calls', 'calls': [
                {'id': f'k{i}', 'function': {'name': 'run_subagent', 'arguments': json.dumps({'task': t})}}
                for i, t in enumerate(turn['calls'])]}
        else:
            yield {'kind': 'text', 'text': turn['text']}
        yield {'kind': 'usage', 'tokens': 5}


CONFIG = AdapterConfig(adapter='ollama', model='m', endpoint='http://fake/v1')


def broker(tmp_path, adapter, control=None, **options):
    control = control or RunControl('sub-run')
    return ToolBroker(str(tmp_path), 'ollama', control, ToolsRequest(enabled=True, subagents=True, **options)), control


# -- the group -----------------------------------------------------------------
def test_children_run_concurrently_and_report_each_state(tmp_path):
    async def go():
        gates = {'a': asyncio.Event(), 'b': asyncio.Event()}
        adapter = Scripted([], gates)
        group = SubagentGroup(RunControl('r'))
        seen, order = [], []

        async def drive():
            async for ev in group.run([('k0', 'a'), ('k1', 'b')], adapter, CONFIG):
                seen.append(ev)
                if ev['kind'] == 'subagent_done':
                    order.append(ev['child_id'])
        task = asyncio.create_task(drive())
        await asyncio.sleep(0.05)
        # both started before either finished: they run side by side
        assert [e['kind'] for e in seen].count('subagent_start') == 2 and not order
        gates['b'].set()
        await asyncio.sleep(0.05)
        assert len(order) == 1
        gates['a'].set()
        await asyncio.wait_for(task, 5)
        return seen
    seen = asyncio.run(go())
    done = {e['child_id']: e for e in seen if e['kind'] == 'subagent_done'}
    assert {d['state'] for d in done.values()} == {'done'} and len(done) == 2


def test_cancelling_one_child_leaves_parent_and_siblings_running(tmp_path):
    async def go():
        gates = {'a': asyncio.Event(), 'b': asyncio.Event()}
        control = RunControl('r')
        group = SubagentGroup(control)
        adapter = Scripted([], gates)
        events, results = [], {}

        async def drive():
            async for ev in group.run([('k0', 'a'), ('k1', 'b')], adapter, CONFIG):
                events.append(ev)
            results.update(group.results)
        task = asyncio.create_task(drive())
        await asyncio.sleep(0.05)
        first = next(e['child_id'] for e in events if e['kind'] == 'subagent_start' and e['parent_call_id'] == 'k0')
        assert group.cancel(first) is True
        await asyncio.sleep(0.05)
        assert not control.stop.is_set() and not task.done()  # parent run and sibling go on
        gates['b'].set()
        await asyncio.wait_for(task, 5)
        return events, results
    events, results = asyncio.run(go())
    states = {e['parent_call_id']: e['state'] for e in events if e['kind'] == 'subagent_done'}
    assert states == {'k0': 'cancelled', 'k1': 'done'}
    assert 'cancelled' in results['k0'] and 'result of b' in results['k1']


def test_cancel_unknown_or_finished_child_is_refused():
    async def go():
        group = SubagentGroup(RunControl('r'))
        assert group.cancel('nope') is False
        async for _ in group.run([('k0', 'x')], Scripted([]), CONFIG):
            pass
        child = next(iter(group.children))
        return group.cancel(child)
    assert asyncio.run(go()) is False


def test_stopping_the_run_ends_every_child():
    async def go():
        control = RunControl('r')
        gates = {'a': asyncio.Event(), 'b': asyncio.Event()}
        group = SubagentGroup(control)
        events = []

        async def drive():
            async for ev in group.run([('k0', 'a'), ('k1', 'b')], Scripted([], gates), CONFIG):
                events.append(ev)
        task = asyncio.create_task(drive())
        await asyncio.sleep(0.05)
        control.stop.set()
        await asyncio.wait_for(task, 2)
        return events
    states = [e['state'] for e in asyncio.run(go()) if e['kind'] == 'subagent_done']
    assert states == ['cancelled', 'cancelled']


def test_limits_are_enforced_by_the_rules_table():
    async def go():
        group = SubagentGroup(RunControl('r'))
        calls = [(f'k{i}', f't{i}') for i in range(SUBAGENT_RULES['max_children'] + 2)]
        events = [e async for e in group.run(calls, Scripted([]), CONFIG)]
        long_task = [e async for e in SubagentGroup(RunControl('r2')).run([('k', 'x' * (SUBAGENT_RULES['task_max_chars'] + 1))], Scripted([]), CONFIG)]
        return events, long_task
    events, long_task = asyncio.run(go())
    assert sum(e['kind'] == 'subagent_start' for e in events) == SUBAGENT_RULES['max_children']
    assert any(e['kind'] == 'subagent_done' and e['state'] == 'error' for e in long_task)


# -- the broker ----------------------------------------------------------------
def test_schema_is_only_offered_when_subagents_are_enabled(tmp_path):
    assert subagent_schema()['function']['name'] == 'run_subagent'
    assert all(s['function']['name'] != 'run_subagent' for s in TOOL_SCHEMAS)


def test_model_can_spawn_two_children_and_gets_their_results(tmp_path):
    adapter = Scripted([{'calls': ['alpha', 'beta']}, {'text': 'combined'}])
    b, _ = broker(tmp_path, adapter)

    async def go():
        return [e async for e in b.stream('do both', adapter, CONFIG)]
    events = asyncio.run(go())
    kinds = [e['kind'] for e in events]
    assert kinds.count('subagent_start') == 2 and kinds.count('subagent_done') == 2
    assert {e['state'] for e in events if e['kind'] == 'subagent_done'} == {'done'}
    assert any(e['kind'] == 'text' and e['text'] == 'combined' for e in events)
    # children spend is counted in the run's usage
    assert max(e['tokens'] for e in events if e['kind'] == 'usage') >= 5 + 5 + 22


def test_subagent_tool_is_refused_when_not_enabled(tmp_path):
    adapter = Scripted([{'calls': ['alpha']}, {'text': 'done'}])
    control = RunControl('off')
    b = ToolBroker(str(tmp_path), 'ollama', control, ToolsRequest(enabled=True))

    async def go():
        return [e async for e in b.stream('x', adapter, CONFIG)]
    events = asyncio.run(go())
    assert not any(e['kind'].startswith('subagent_') for e in events) and adapter.child_tasks == []


# -- API -----------------------------------------------------------------------
@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def test_cancel_route_targets_one_child_and_reports_conflicts(client):
    control = RunControl('route-run')
    RUNS['route-run'] = control
    try:
        group = SubagentGroup(control)
        control.subagents = group
        child = group.register('k0', 'task')
        assert client.post(f'/execute/route-run/subagents/{child.id}/cancel').json() == {'child_id': child.id, 'state': 'cancelled'}
        assert client.post(f'/execute/route-run/subagents/{child.id}/cancel').status_code == 409
        assert client.post('/execute/route-run/subagents/missing/cancel').status_code == 404
        assert client.post('/execute/no-such-run/subagents/x/cancel').status_code == 404
        assert not control.stop.is_set()
    finally:
        RUNS.pop('route-run', None)


def test_direct_run_streams_subagent_events_and_journals_them(client, tmp_path, monkeypatch):
    adapter = Scripted([{'calls': ['alpha', 'beta']}, {'text': 'combined'}])
    monkeypatch.setattr('providers.resolution.get_adapter', lambda name: adapter)
    app.state.provider_connections = {'local': {'id': 'local', 'provider': 'ollama', 'label': 'Local', 'residence': 'local',
                                                'endpoint': 'http://127.0.0.1:11434/v1', 'enabled': True, 'secretRef': None}}
    client.post('/cowork/projects', json={'name': 'Sub', 'rootPath': str(tmp_path)})
    resp = client.post('/execute/direct', json={'instruction': 'go', 'mode': 'live', 'connection_id': 'local', 'model': 'm',
                                                'cwd': str(tmp_path),
                                                'tools': {'enabled': True, 'subagents': True}})
    names = [b.splitlines()[0][7:] for b in resp.text.strip().split('\n\n') if b.startswith('event: ')]
    assert names.count('subagent_start') == 2 and names.count('subagent_done') == 2
    journal = client.get(f"/execute/logs/{resp.headers['X-Execution-Id']}/events").json()
    rows = journal['events'] if isinstance(journal, dict) else journal
    assert sum(r['event'] == 'subagent_done' for r in rows) == 2


# -- review follow-ups ---------------------------------------------------------
def test_reused_call_ids_across_turns_do_not_cross_results_or_double_count(tmp_path):
    adapter = Scripted([{'calls': ['first']}, {'calls': ['second']}, {'text': 'end'}])
    b, _ = broker(tmp_path, adapter)

    async def go():
        return [e async for e in b.stream('x', adapter, CONFIG)]
    events = asyncio.run(go())
    # both turns used the call id "k0": the second turn's usage adds only its own child
    totals = [e['tokens'] for e in events if e['kind'] == 'usage']
    assert totals == sorted(totals) and totals[-1] == 5 + 5 + 5 + 11 + 11


def test_subagents_only_turn_offers_no_workspace_tool_and_runs_none(tmp_path):
    (tmp_path / 'README.md').write_text('private')
    seen = {}

    class Greedy(Scripted):
        async def stream_turn(self, messages, config, tools=None):
            seen.setdefault('tools', [t['function']['name'] for t in tools or []])
            if len(seen) == 1 and 'asked' not in seen:
                seen['asked'] = True
                yield {'kind': 'tool_calls', 'calls': [{'id': 'r', 'function': {'name': 'read_file', 'arguments': '{"path": "README.md"}'}}]}
            else:
                yield {'kind': 'text', 'text': 'ok'}
    adapter = Greedy([])
    control = RunControl('only')
    b = ToolBroker(str(tmp_path), 'ollama', control, ToolsRequest(subagents=True))

    async def go():
        return [e async for e in b.stream('x', adapter, CONFIG)]
    events = asyncio.run(go())
    assert seen['tools'] == ['run_subagent']
    assert not any(e['kind'] == 'tool_result' for e in events)  # the read never ran
    assert any(e['kind'] == 'tool_denied' for e in events)


def test_child_cancelled_before_its_first_step_still_ends_the_run(tmp_path):
    async def go():
        group = SubagentGroup(RunControl('r'))
        events = []

        async def drive():
            async for ev in group.run([('k0', 'a')], Scripted([]), CONFIG):
                events.append(ev)
                if ev['kind'] == 'subagent_start':
                    group.cancel(ev['child_id'])  # the task has not taken a step yet
        await asyncio.wait_for(drive(), 2)
        return events, group.results
    events, results = asyncio.run(go())
    assert [e['state'] for e in events if e['kind'] == 'subagent_done'] == ['cancelled']
    assert 'cancelled' in results['k0']


def test_secrets_in_task_and_child_output_are_redacted(tmp_path):
    secret = 'sk-' + 'B' * 30  # gitleaks:allow

    class Leaky(Scripted):
        async def stream_events(self, prompt, config):
            yield {'kind': 'text', 'text': f'token is {secret}'}
    task = 'x' * 190 + secret

    async def go():
        group = SubagentGroup(RunControl('r'))
        events = [e async for e in group.run([('k0', task)], Leaky([]), CONFIG)]
        return events, group.results
    events, results = asyncio.run(go())
    assert secret[:6] not in events[0]['task'] or secret not in events[0]['task']
    assert 'sk-BBBB' not in events[0]['task'] and secret not in results['k0']


def test_invalid_tasks_do_not_use_up_child_slots():
    async def go():
        group = SubagentGroup(RunControl('r'))
        calls = [(f'bad{i}', '') for i in range(6)] + [(f'ok{i}', f't{i}') for i in range(SUBAGENT_RULES['max_children'])]
        return [e async for e in group.run(calls, Scripted([]), CONFIG)]
    events = asyncio.run(go())
    assert sum(e['kind'] == 'subagent_done' and e['state'] == 'done' for e in events) == SUBAGENT_RULES['max_children']


def test_cancel_route_tells_missing_run_from_missing_child(client):
    assert client.post('/execute/no-run/subagents/x/cancel').json() == {'error': 'run_not_found'}
