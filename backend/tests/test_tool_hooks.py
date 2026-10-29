"""#165: pre-tool hooks block (fail-closed) and the journal records the decision."""
import asyncio
import json
import os
import sys
import textwrap

import pytest
from fastapi.testclient import TestClient

from engine import RunControl
from main import app
from sandbox.broker import ToolBroker
from sandbox.hooks import HOOK_RULES, Hook, run_hook, validate_hook
from sandbox.schemas import ToolsRequest


def script(tmp_path, body, name='hook.py'):
    path = tmp_path / name
    path.write_text(textwrap.dedent(body), encoding='utf-8')
    return [sys.executable, str(path)]


def hook(argv, hook_id='audit', timeout_s=3, tools=('exec', 'read', 'discover')):
    return Hook(id=hook_id, argv=list(argv), timeout_s=timeout_s, tools=tuple(tools))


def decide(h, tmp_path, tool='read', args=None):
    return asyncio.run(run_hook(h, {'call_id': 'c1', 'tool': tool, 'args': args or {}}, tmp_path))


# -- runner: fail-closed ------------------------------------------------------
def test_exit_zero_allows(tmp_path):
    assert decide(hook(script(tmp_path, 'import sys; sys.stdin.read()')), tmp_path).allowed


def test_nonzero_exit_blocks_with_hook_id(tmp_path):
    d = decide(hook(script(tmp_path, 'raise SystemExit(3)')), tmp_path)
    assert not d.allowed and d.hook_id == 'audit' and d.reason == 'exit_nonzero'


def test_timeout_blocks_and_kills(tmp_path):
    d = decide(hook(script(tmp_path, 'import time; time.sleep(30)'), timeout_s=0.5), tmp_path)
    assert not d.allowed and d.reason == 'timeout'


def test_missing_executable_blocks(tmp_path):
    d = decide(hook([str(tmp_path / 'nope')]), tmp_path)
    assert not d.allowed and d.reason == 'spawn_error'


def test_invalid_config_blocks(tmp_path):
    d = decide(Hook(id='bad', argv=[], timeout_s=1, tools=('read',), invalid=True), tmp_path)
    assert not d.allowed and d.reason == 'invalid_config'


def test_no_secret_reaches_the_hook_environment_or_payload(tmp_path, monkeypatch):
    monkeypatch.setenv('OH_TEST_SECRET_TOKEN', 'hunter2-environment')  # gitleaks:allow
    monkeypatch.setenv('ANTHROPIC_API_KEY', 'env-value-not-for-hooks')  # gitleaks:allow
    out = tmp_path / 'seen.json'
    argv = script(tmp_path, f"""
        import json, os, sys
        open({str(out)!r}, 'w').write(json.dumps({{'env': dict(os.environ), 'stdin': sys.stdin.read()}}))
    """)
    secret_arg = 'sk-' + 'A' * 30  # gitleaks:allow
    assert decide(hook(argv), tmp_path, tool='exec', args={'argv': ['echo', secret_arg]}).allowed
    seen = json.loads(out.read_text())
    assert 'OH_TEST_SECRET_TOKEN' not in seen['env'] and 'ANTHROPIC_API_KEY' not in seen['env']
    assert secret_arg not in seen['stdin']
    assert json.loads(seen['stdin'])['tool'] == 'exec'


def test_no_shell_interpretation_of_argv(tmp_path):
    marker = tmp_path / 'injected'
    argv = script(tmp_path, 'import sys; sys.exit(0)') + [f'; touch {marker}']
    assert decide(hook(argv), tmp_path).allowed
    assert not marker.exists()


# -- validation: one table for API and UI ------------------------------------
def test_validate_hook_rules(tmp_path):
    ok = {'argv': [sys.executable, 'x.py'], 'timeout_s': 2, 'tools': ['read']}
    assert validate_hook('audit-1', ok).id == 'audit-1'
    for bad_id in ('', 'A B', '../x', 'x' * 65):
        with pytest.raises(ValueError):
            validate_hook(bad_id, ok)
    for patch in ({'argv': []}, {'argv': ['python']}, {'argv': ['/bin/sh', '-c', 'true']},
                  {'argv': [os.sep + 'usr' + os.sep + 'bin' + os.sep + 'bash']}, {'timeout_s': 0},
                  {'timeout_s': HOOK_RULES['timeout_s']['max'] + 1}, {'tools': ['write']}, {'tools': []},
                  {'argv': [sys.executable] + ['a'] * 40}):
        with pytest.raises(ValueError):
            validate_hook('audit', {**ok, **patch})


# -- broker -------------------------------------------------------------------
def broker_events(tmp_path, hooks, name='exec', args=None):
    control = RunControl('hook-run')
    broker = ToolBroker(str(tmp_path), 'ollama', control, ToolsRequest(enabled=True), permission_mode='auto_workspace', hooks=hooks)

    async def go():
        out = []
        async for event in broker.call(name, args or {'argv': ['git', '--version']}, origin='model'):
            out.append(event)
            if event['kind'] == 'tool_approval_required':
                control.tool_approval.decide(event['call_id'], 'approve', '')
        return out
    return asyncio.run(go())


def test_blocking_hook_prevents_the_tool_and_is_journaled(tmp_path):
    marker = tmp_path / 'ran'
    h = hook(script(tmp_path, 'raise SystemExit(1)'), hook_id='guard')
    events = broker_events(tmp_path, [h], args={'argv': [sys.executable, '-c', f'open({str(marker)!r},"w")']})
    kinds = [e['kind'] for e in events]
    assert kinds == ['tool_call', 'tool_hook_decision', 'tool_denied']
    assert events[1]['hook_id'] == 'guard' and events[1]['decision'] == 'block' and events[1]['reason'] == 'exit_nonzero'
    assert events[2]['reason'] == 'hook' and not marker.exists()


def test_allowing_hook_records_decision_and_tool_runs(tmp_path):
    h = hook(script(tmp_path, 'pass'), hook_id='ok1')
    events = broker_events(tmp_path, [h])
    decision = [e for e in events if e['kind'] == 'tool_hook_decision']
    assert decision and decision[0]['decision'] == 'allow' and decision[0]['hook_id'] == 'ok1'
    assert events[-1]['kind'] == 'tool_result'


def test_hook_for_other_tools_does_not_run(tmp_path):
    h = hook(script(tmp_path, 'raise SystemExit(1)'), tools=('read',))
    assert 'tool_hook_decision' not in [e['kind'] for e in broker_events(tmp_path, [h])]


def test_first_blocking_hook_stops_the_chain(tmp_path):
    a, b = hook(script(tmp_path, 'raise SystemExit(1)', 'a.py'), 'a'), hook(script(tmp_path, 'raise SystemExit(1)', 'b.py'), 'b')
    ids = [e['hook_id'] for e in broker_events(tmp_path, [a, b]) if e['kind'] == 'tool_hook_decision']
    assert ids == ['a']


# -- API ----------------------------------------------------------------------
@pytest.fixture()
def client(tmp_path):
    with TestClient(app) as c:
        c.post('/cowork/projects', json={'name': 'Hooks', 'rootPath': str(tmp_path)})
        yield c


def sse(response):
    return [{'event': b.splitlines()[0][7:], 'data': json.loads(b.splitlines()[1][6:])}
            for b in response.text.strip().split('\n\n') if b.startswith('event: ')]


def test_hook_registry_crud_and_validation(client, tmp_path):
    body = {'argv': script(tmp_path, 'pass'), 'timeout_s': 2, 'tools': ['read']}
    saved = client.put('/chat/tools/hooks/h1', json=body)
    assert saved.status_code == 200
    assert [h['id'] for h in client.get('/chat/tools/hooks').json()['hooks']] == ['h1']
    refused = client.put('/chat/tools/hooks/h1', json={**body, 'argv': ['python']})
    removed = client.delete('/chat/tools/hooks/h1')
    assert refused.status_code == 400 and removed.status_code == 200
    assert client.get('/chat/tools/hooks').json()['hooks'] == []


def test_blocked_call_is_in_the_run_journal_with_the_hook_id(client, tmp_path):
    (tmp_path / 'README.md').write_text('hi', encoding='utf-8')
    body = {'argv': script(tmp_path, 'raise SystemExit(2)'), 'timeout_s': 2, 'tools': ['read']}
    saved = client.put('/chat/tools/hooks/guard', json=body)
    assert saved.status_code == 200
    try:
        resp = client.post('/execute/direct', json={'instruction': '', 'mode': 'mock', 'cwd': str(tmp_path),
                           'tools': {'enabled': True, 'summarize': False, 'preset': {'name': 'read', 'path': 'README.md'}}})
        events = sse(resp)
        assert not any(e['event'] == 'tool_result' for e in events)
        decision = next(e for e in events if e['event'] == 'tool_hook_decision')
        assert decision['data']['hook_id'] == 'guard' and decision['data']['decision'] == 'block'
        journal = client.get(f"/execute/logs/{resp.headers['X-Execution-Id']}/events").json()
        rows = journal['events'] if isinstance(journal, dict) else journal
        assert any(r['event'] == 'tool_hook_decision' and r['data']['hook_id'] == 'guard' for r in rows)
    finally:
        client.delete('/chat/tools/hooks/guard')


def test_hook_added_mid_run_applies_to_the_next_call(tmp_path):
    current = []

    async def loader():
        return list(current)
    control = RunControl('hook-live')
    broker = ToolBroker(str(tmp_path), 'ollama', control, ToolsRequest(enabled=True), permission_mode='auto_workspace', hooks_loader=loader)

    async def go():
        first = [e['kind'] async for e in broker.call('discover', {}, origin='model')]
        current.append(hook(script(tmp_path, 'raise SystemExit(1)'), tools=('discover',)))
        second = [e['kind'] async for e in broker.call('discover', {}, origin='model')]
        return first, second
    first, second = asyncio.run(go())
    assert 'tool_hook_decision' not in first and second[-1] == 'tool_denied'


def test_exiting_hook_leaves_no_descendant(tmp_path):
    pidfile = tmp_path / 'pid'
    argv = script(tmp_path, f"""
        import subprocess, sys
        child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'], stdin=subprocess.DEVNULL,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        open({str(pidfile)!r}, 'w').write(str(child.pid))
    """)
    assert decide(hook(argv), tmp_path).allowed
    pid = int(pidfile.read_text())
    import time
    for _ in range(30):
        try:
            with open(f'/proc/{pid}/stat') as f:
                if f.read().split(')')[1].split()[0] == 'Z':
                    break
        except FileNotFoundError:
            break
        time.sleep(0.1)
    else:
        raise AssertionError('descendant still running')


def test_hook_that_leaves_a_child_holding_its_pipes_is_blocked_by_the_timeout(tmp_path):
    argv = script(tmp_path, "import subprocess, sys; subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])")
    d = decide(hook(argv, timeout_s=0.7), tmp_path)
    assert not d.allowed and d.reason == 'timeout'


# -- round 2: a simulated run executes nothing, hooks included ------------------
def mock_events(tmp_path, hooks, name='exec', args=None):
    control = RunControl('hook-mock')
    broker = ToolBroker(str(tmp_path), 'mock', control, ToolsRequest(enabled=True), permission_mode='ask', hooks=hooks)

    async def go():
        return [e async for e in broker.call(name, args or {'argv': ['git', '--version']}, origin='model')]
    return asyncio.run(go())


def test_simulated_exec_does_not_start_hooks_and_says_so(tmp_path):
    marker = tmp_path / 'hook-ran'
    events = mock_events(tmp_path, [hook(script(tmp_path, f'open({str(marker)!r}, "w")'), hook_id='guard'),
                                    hook(script(tmp_path, 'pass', 'other.py'), hook_id='read-only', tools=('read',))])
    assert [e['kind'] for e in events] == ['tool_call', 'tool_hook_decision', 'tool_result']
    assert events[1]['hook_id'] == 'guard' and events[1]['decision'] == 'skipped' and events[1]['reason'] == 'simulated'
    assert events[2]['simulated'] is True and not marker.exists()


def test_plan_mode_refusal_comes_before_any_hook_runs(tmp_path):
    control = RunControl('plan')
    marker = tmp_path / 'hook-ran'
    h = hook(script(tmp_path, f'open({str(marker)!r}, "w")'))
    broker = ToolBroker(str(tmp_path), 'ollama', control, ToolsRequest(enabled=True), permission_mode='plan', hooks=[h])

    async def go():
        return [e['kind'] async for e in broker.call('exec', {'argv': ['git', '--version']}, origin='model')]
    assert asyncio.run(go()) == ['tool_call', 'tool_denied'] and not marker.exists()
