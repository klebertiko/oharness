"""Permission presets (#161): one table drives the validator (here) and the UI (parity test in the frontend)."""
import asyncio
import json
import sys
from pathlib import Path

import pytest

from engine import RunControl
from sandbox import permission
from sandbox.broker import ToolBroker
from sandbox.schemas import Exec, ToolsRequest

TABLE = json.loads((Path(permission.__file__).parent / 'permission_modes.json').read_text(encoding='utf-8'))


def call(argv, cwd='.'):
    return Exec(argv=argv, cwd=cwd)


def run_exec(root, mode, argv, decision='approve', cwd='.', trusted=False):
    control = RunControl('preset-broker')
    broker = ToolBroker(str(root), 'ollama', control, ToolsRequest(enabled=True), permission_mode=mode, workspace_trusted=trusted)

    async def collect():
        events = []
        async for event in broker.call('exec', {'argv': argv, 'cwd': cwd, 'timeout_s': 20}, origin='model'):
            events.append(event)
            if event['kind'] == 'tool_approval_required':
                control.tool_approval.decide(event['call_id'], decision, 'checked')
        return events
    return asyncio.run(collect())


def kinds(events):
    return [e['kind'] for e in events]


def test_the_table_is_the_only_source_of_modes():
    ids = [m['id'] for m in TABLE['modes']]
    assert tuple(ids) == permission.MODES and TABLE['default'] == permission.DEFAULT_MODE
    assert ids == ['plan', 'read_only', 'ask', 'auto_workspace', 'workspace_write', 'full']


def test_every_mode_defines_a_rule_for_every_exec_class_and_no_bypass_exists():
    for mode in TABLE['modes']:
        assert set(mode['rules']) == set(permission.EXEC_CLASSES)
        assert set(mode['rules'].values()) <= {'allow', 'ask', 'deny', 'allow_if_trusted'}
        assert 'bypass' not in mode['id'] and 'danger' not in mode['id']
    assert 'bypass' not in permission.MODES


@pytest.mark.parametrize('argv,cls', [
    (['ls'], 'exec_read'), (['git', '--version'], 'exec_read'),
    (['npm', 'test'], 'exec_project'),
    (['touch', 'a.txt'], 'exec_write_inside'), (['mkdir', '-p', 'sub/dir'], 'exec_write_inside'), (['cp', 'a', 'b'], 'exec_write_inside'),
    (['touch', '../escape.txt'], 'exec_write_outside'), (['cp', 'a', '/tmp/x'], 'exec_write_outside'), (['mv', 'a', '~/b'], 'exec_write_outside'),
    (['touch', '.git/hooks/pre-commit'], 'exec_other'),
    (['python', '-c', 'print(1)'], 'exec_other'), (['rm', '-rf', 'x'], 'exec_other'),
])
def test_exec_calls_are_classified(tmp_path, argv, cls):
    (tmp_path / 'sub').mkdir()
    assert permission.exec_class(call(argv), tmp_path) == cls


def test_exec_class_defaults_unknown_to_other(tmp_path):
    assert permission.exec_class(call(['ls']), None) == 'exec_other'
    assert permission.exec_class(call(['touch', 'a'], cwd='/abs'), tmp_path) == 'exec_other'


# -- read-only: a write is refused, with the reason visible -------------------
def test_read_only_refuses_a_write_and_never_runs_it(tmp_path):
    events = run_exec(tmp_path, 'read_only', ['touch', 'made.txt'])
    assert kinds(events) == ['tool_call', 'tool_denied']
    assert events[-1]['reason'] == 'policy' and 'read-only' in events[-1]['note'].lower()
    assert not (tmp_path / 'made.txt').exists()


def test_read_only_refuses_a_command_it_cannot_prove_read_only(tmp_path):
    marker = tmp_path / 'ran'
    events = run_exec(tmp_path, 'read_only', [sys.executable, '-c', f'open({str(marker)!r}, "w")'])
    assert kinds(events) == ['tool_call', 'tool_denied'] and not marker.exists()


def test_read_only_runs_read_only_commands_and_reads_files(tmp_path):
    events = run_exec(tmp_path, 'read_only', ['git', '--version'])
    assert kinds(events) == ['tool_call', 'tool_auto_approved', 'tool_result']
    assert events[1]['mode'] == 'read_only'


# -- workspace write: inside runs, outside asks -------------------------------
def test_workspace_write_runs_an_inside_write_without_asking_and_records_why(tmp_path):
    events = run_exec(tmp_path, 'workspace_write', ['touch', 'made.txt'])
    assert kinds(events) == ['tool_call', 'tool_auto_approved', 'tool_result']
    assert events[1]['mode'] == 'workspace_write' and (tmp_path / 'made.txt').exists()


def test_workspace_write_asks_before_a_write_outside_the_workspace(tmp_path):
    inner = tmp_path / 'inner'
    inner.mkdir()
    events = run_exec(inner, 'workspace_write', ['touch', '../outside.txt'], decision='reject')
    assert kinds(events) == ['tool_call', 'tool_approval_required', 'tool_approval_decision', 'tool_denied']
    assert events[1]['name'] == 'exec' and not (tmp_path / 'outside.txt').exists()


def test_workspace_write_asks_for_a_command_it_cannot_check(tmp_path):
    events = run_exec(tmp_path, 'workspace_write', [sys.executable, '--version'], decision='reject')
    assert 'tool_approval_required' in kinds(events) and 'tool_auto_approved' not in kinds(events)


def test_workspace_write_project_scripts_still_need_trust(tmp_path):
    (tmp_path / 'package.json').write_text('{}', encoding='utf-8')
    events = run_exec(tmp_path, 'workspace_write', ['npm', 'test'], decision='reject', trusted=False)
    assert 'tool_approval_required' in kinds(events)


# -- full: runs, but high risk and secrets still ask --------------------------
def test_full_runs_an_unclassified_command_without_asking(tmp_path):
    events = run_exec(tmp_path, 'full', [sys.executable, '--version'])
    assert kinds(events) == ['tool_call', 'tool_auto_approved', 'tool_result'] and events[1]['mode'] == 'full'


def test_full_still_asks_for_a_high_risk_command(tmp_path):
    events = run_exec(tmp_path, 'full', ['git', 'clean', '-fd'], decision='reject')
    assert events[1]['kind'] == 'tool_approval_required' and events[1]['risk'] == 'high'


def test_full_still_asks_before_reading_a_secret_file(tmp_path):
    (tmp_path / '.env').write_text('A=1', encoding='utf-8')
    control = RunControl('full-secret')
    broker = ToolBroker(str(tmp_path), 'ollama', control, ToolsRequest(enabled=True), permission_mode='full')

    async def collect():
        events = []
        async for event in broker.call('read', {'path': '.env'}, origin='model'):
            events.append(event)
            if event['kind'] == 'tool_approval_required':
                control.tool_approval.decide(event['call_id'], 'reject', '')
        return events
    assert 'tool_approval_required' in kinds(asyncio.run(collect()))


# -- strictness ordering: a request can only tighten --------------------------
@pytest.mark.parametrize('stored,requested,expected', [
    ('full', 'read_only', 'read_only'), ('read_only', 'full', 'read_only'), ('workspace_write', 'auto_workspace', 'auto_workspace'),
    ('ask', 'workspace_write', 'ask'), ('plan', 'full', 'plan'), ('full', None, 'full'), ('full', 'bypass', 'ask'),
])
def test_effective_mode_only_tightens(stored, requested, expected):
    assert permission.effective_mode(stored, requested) == expected


def test_the_api_literal_lists_exactly_the_table_modes():
    from typing import get_args
    from sandbox.schemas import PermissionMode
    assert get_args(PermissionMode) == permission.MODES


# -- API: presets end to end ---------------------------------------------------
from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402

THREAD = 'thread-preset'


def sse(response):
    return [{'event': block.splitlines()[0][7:], 'data': json.loads(block.splitlines()[1][6:])}
            for block in response.text.strip().split('\n\n') if block.startswith('event: ')]


@pytest.fixture()
def client(tmp_path):
    with TestClient(app) as client:
        client.post('/cowork/projects', json={'name': 'Preset', 'rootPath': str(tmp_path)})
        yield client


def direct(client, tmp_path, argv):
    body = {'instruction': '', 'mode': 'mock', 'cwd': str(tmp_path),
            'tools': {'enabled': True, 'summarize': False, 'thread_id': THREAD, 'preset': {'name': 'exec', 'argv': argv}}}
    return sse(client.post('/execute/direct', json=body))


@pytest.mark.parametrize('mode', ['plan', 'read_only', 'ask', 'auto_workspace', 'workspace_write', 'full'])
def test_every_table_mode_round_trips(client, mode):
    assert client.put('/chat/tools/permission', json={'thread_id': THREAD, 'mode': mode}).json()['mode'] == mode
    assert client.get('/chat/tools/permission', params={'thread_id': THREAD}).json()['mode'] == mode


@pytest.mark.parametrize('mode', ['bypass', 'dangerously-bypass', 'dangerously_bypass', 'yolo'])
def test_there_is_no_bypass_preset(client, mode):
    response = client.put('/chat/tools/permission', json={'thread_id': THREAD, 'mode': mode})
    assert response.status_code == 400 and response.json()['error'] == 'invalid_argument'


def test_a_read_only_session_refuses_a_write_with_a_visible_reason(client, tmp_path):
    client.put('/chat/tools/permission', json={'thread_id': THREAD, 'mode': 'read_only'})
    events = direct(client, tmp_path, ['touch', 'made.txt'])
    denied = next(e['data'] for e in events if e['event'] == 'tool_denied')
    assert denied['reason'] == 'policy' and 'read-only' in denied['note'].lower()
    assert not any(e['event'] in {'tool_result', 'tool_approval_required'} for e in events)


def test_a_workspace_write_session_does_not_gate_an_inside_write(client, tmp_path):
    # The mock adapter simulates the call before any gate, so the outside-asks case is covered at broker level above.
    client.put('/chat/tools/permission', json={'thread_id': THREAD, 'mode': 'workspace_write'})
    events = direct(client, tmp_path, ['touch', 'made.txt'])
    assert not any(e['event'] in {'tool_denied', 'tool_approval_required'} for e in events)
    assert next(e['data'] for e in events if e['event'] == 'capabilities')['permission_mode'] == 'workspace_write'
