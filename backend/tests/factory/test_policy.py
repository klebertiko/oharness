"""Network policy, the MCP client, the harness an agent names, and which runner a task uses."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import anyio
import pytest
from sqlalchemy import delete, select

from database import SessionLocal, init_db
from factory import agent_mcp, loop, network, runner, service
from factory.dispatch import DispatchError
from factory.models import WorkItemCreate
from factory.orm import WorkItem, WorkItemArtifact, WorkItemEvent, WorkItemRun
from models import Harness, RunEvent
from secret_store.memory import MemorySecrets
from workspaces.service import WorkspaceService

VALUE = 'Zq9-' + 'k3Lm' * 4
SCRIPT = (
    'import json,sys\n'
    'for line in sys.stdin:\n'
    '    msg = json.loads(line)\n'
    '    if "id" not in msg:\n'
    '        continue\n'
    '    result ={"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}} if msg.get("method") == "initialize" else {"tools": [{"name": "docs"}]}\n'
    '    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": result}) + "\\n")\n'
    '    sys.stdout.flush()\n'
)


def agent(role, secrets=None):
    return {'role': role, 'model': 'openai/gpt-4o', 'harness': 'local', 'engine': None, 'enabled': True,
            'permissions': {'mode': 'workspace_write', 'maxTokens': 1000}, 'skills': [], 'mcp': [],
            'secrets': secrets or [], 'localSkills': {}, 'instructions': 'do the work', 'memory': {}}


def defn(**extra):
    body = {'name': 'payments', 'policy': {'requireSpec': False, 'specApproval': 'required', 'maxReviewReturns': 2,
                                           'reviewIndependence': 'require', 'maxPermissionMode': 'workspace_write'},
            'ceilings': {'tokensPerRun': 100000},
            'repositories': [{'id': 'app', 'path': '.', 'protectedBranches': ['main']}],
            'runners': {'main': {'type': 'local', 'maxConcurrentRuns': 2, 'credentialStrategy': 'forja'},
                        'fast': {'type': 'local', 'maxConcurrentRuns': 1, 'credentialStrategy': 'forja'}},
            'agents': {'builder': agent('implement', ['forja/npm-token'])},
            'networkPolicy': {'allowedHosts': ['api.example.com'], 'deniedHosts': ['blocked.example.com']}}
    body.update(extra)
    return body


def _repo(tmp_path: Path, monkeypatch):
    for key in ('HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME'):
        monkeypatch.setenv(key, str(tmp_path / 'home'))
    (tmp_path / 'home').mkdir()
    monkeypatch.setenv('OH_WORKSPACES_HOME', str(tmp_path / 'oh-data'))
    git = WorkspaceService().runner
    repo = tmp_path / 'repo'
    repo.mkdir()
    git.run(repo, ['init', '-q', '-b', 'main'])
    git.run(repo, ['-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '--allow-empty', '-m', 'base'])
    return repo


async def _reset():
    async with SessionLocal() as db:
        for table in (RunEvent, WorkItemEvent, WorkItemRun, WorkItemArtifact, WorkItem, Harness):
            await db.execute(delete(table))
        await db.commit()


@pytest.fixture()
def ready():
    anyio.run(init_db)
    loop.BOARD.reset()
    agent_mcp.clear()
    yield
    loop.BOARD.reset()
    agent_mcp.clear()
    anyio.run(_reset)


def test_a_denied_host_is_refused_before_the_command_and_an_allowed_host_passes_the_policy():
    definition = defn()

    async def case():
        denied = await runner.run_as_agent(definition, 'builder', ['curl', 'https://blocked.example.com/a'], {'path': '/nope', 'id': 'x'}, MemorySecrets())
        try:
            await runner.run_as_agent(definition, 'builder', ['curl', 'https://api.example.com/a'], {'path': '/nope', 'id': 'x'}, MemorySecrets())
        except runner.RunnerError as exc:
            allowed = str(exc)
        else:
            allowed = 'ran'
        return denied, allowed

    denied, allowed = anyio.run(case)
    assert denied['ok'] is False and denied['exit_code'] is None
    assert denied['result'] == 'The network policy denies blocked.example.com.'
    assert 'network policy' not in allowed
    both = dict(definition)
    both['agents'] = {'builder': {**definition['agents']['builder'], 'networkPolicy': {'allowedHosts': ['blocked.example.com']}}}
    assert network.command_denied(both, 'builder', ['curl', 'https://blocked.example.com/a']) == 'The network policy denies blocked.example.com.'


def test_the_runner_follows_the_task_then_the_agent_then_the_default():
    definition = defn()
    definition['agents']['builder']['runner'] = 'fast'
    assert runner.select_runner(definition, task='main', agent='fast') == 'main'
    assert runner.select_runner(definition, agent='fast') == 'fast'
    assert runner.select_runner(definition) == 'main'


def test_the_mcp_client_talks_to_a_process_and_to_an_in_process_server():
    seen = []

    def handler(method, params):
        seen.append(method)
        if method == 'initialize':
            return {'jsonrpc': '2.0', 'id': 1, 'result': {}}
        return {'jsonrpc': '2.0', 'id': 2, 'result': {'tools': [{'name': 'docs'}]}}

    async def memory():
        return await agent_mcp.list_tools(agent_mcp.MemoryTransport(handler))

    async def process():
        transport = agent_mcp.StdioTransport(sys.executable, ['-c', SCRIPT])
        try:
            return await agent_mcp.list_tools(transport)
        finally:
            await transport.close()

    assert anyio.run(memory) == ['docs'] and seen == ['initialize', 'tools/list']
    assert anyio.run(process) == ['docs']


def test_a_run_uses_the_named_engine_and_the_agents_tools(ready, tmp_path, monkeypatch):
    repo = _repo(tmp_path, monkeypatch)
    store = MemorySecrets()
    store.put('forja/npm-token', VALUE)
    definition = defn()
    definition['agents']['builder']['engine'] = 'studio-reader'
    definition['agents']['builder']['permissions'] = {'mode': 'read_only', 'maxTokens': 1000}
    definition['agents']['builder']['mcp'] = ['docs']
    definition['mcp'] = {'docs': {'command': 'python3'}}
    agent_mcp.use('docs', agent_mcp.MemoryTransport(lambda method, params: {'jsonrpc': '2.0', 'id': 1, 'result': {} if method == 'initialize' else {'tools': [{'name': 'docs'}]}}))

    async def case():
        async with SessionLocal() as db:
            db.add(Harness(id='studio-reader', name='Reader', description='', graph_json='{}'))
            await db.commit()
            item, *_ = await service.create(db, WorkItemCreate(factory_id='payments', title='Fix login', source={'kind': 'manual', 'ref': 'eng'},
                                                               origin_context={'text': 'It breaks.'}))
            await service.enter_stage(db, item, 'implement', ('system', None))
            await db.commit()
            item_id = item.id
        try:
            await loop.start(item_id, defn() | {'agents': {'builder': {**definition['agents']['builder'], 'engine': 'missing'}}}, repo, store)
        except DispatchError as exc:
            missing = str(exc)
        else:
            missing = ''
        run_id = await loop.start(item_id, definition, repo, store, runner_id='fast')
        async with SessionLocal() as db:
            links = (await db.scalars(select(WorkItemRun).where(WorkItemRun.work_item_id == item_id))).all()
            rows = await db.scalars(select(RunEvent).where(RunEvent.run_id == run_id))
            journal = [(row.event_type, json.loads(row.data_json)) for row in rows]
        async with SessionLocal() as db:
            from factory.harness_bind import engine_id
            db.add(Harness(id='studio-spec', name='Spec', description='', graph_json='{}'))
            await db.commit()
            pair = (await engine_id(db, {'engine': 'studio-reader'}), await engine_id(db, {'engine': 'studio-spec'}))
        return missing, links, journal, loop.BOARD.get(run_id), pair

    missing, links, journal, row, pair = anyio.run(case)
    assert missing == 'that engine is not in the Studio'
    assert len(links) == 1
    text = json.dumps(journal)
    assert 'engine studio-reader' in text and 'tools docs' in text
    assert row.engine == 'studio-reader' and ('payments', 'fast', 1) in loop.BOARD.pools
    assert pair == ('studio-reader', 'studio-spec')
    assert '.ohm' not in text and 'Bundle' not in text


def test_a_failed_setup_names_the_command_and_hides_the_secret(ready, tmp_path, monkeypatch):
    repo = _repo(tmp_path, monkeypatch)
    store = MemorySecrets()
    store.put('forja/npm-token', VALUE)
    definition = defn()
    definition['runners']['main']['setup'] = [['python3', '-c', 'import os,sys; print(os.environ.get("FORJA_SECRET_NPM_TOKEN", "")); sys.exit(2)']]

    async def case():
        async with SessionLocal() as db:
            item, *_ = await service.create(db, WorkItemCreate(factory_id='payments', title='Fix login', source={'kind': 'manual', 'ref': 'setup'},
                                                               origin_context={'text': 'It breaks.'}))
            await service.enter_stage(db, item, 'implement', ('system', None))
            await db.commit()
            item_id = item.id
        run_id = await loop.start(item_id, definition, repo, store)
        async with SessionLocal() as db:
            events = await service.events(db, item_id, 0, 200)
            rows = await db.scalars(select(RunEvent).where(RunEvent.run_id == run_id))
            journal = json.dumps([(row.event_type, json.loads(row.data_json)) for row in rows])
        return events, journal

    events, journal = anyio.run(case)
    blob = journal + ''.join(event.data_json for event in events)
    assert 'setup failed: python3' in blob
    assert VALUE not in blob


# ------------------------------------------------------------------------------------------------ the policy fails closed

@pytest.mark.parametrize('argv', [
    ['curl', 'evil.example.net/x'],
    ['git', 'clone', 'git@evil.example.net:o/r.git'],
    ['ssh', 'deploy@evil.example.net'],
    ['curl', 'http://user@evil.example.net/'],
    ['curl', '203.0.113.7:8080'],
    ['wget', 'ftp://evil.example.net/file'],
    ['curl', 'https://EVIL.example.net./'],
])
def test_a_host_named_without_https_is_judged_too(argv):
    assert network.command_denied(defn(), 'builder', argv) is not None, argv


def test_an_allowed_host_and_a_local_command_still_pass():
    assert network.command_denied(defn(), 'builder', ['curl', 'https://api.example.com/v1']) is None
    assert network.command_denied(defn(), 'builder', ['python', '-m', 'pytest', 'tests/test_app.py']) is None


def test_extending_a_policy_that_does_not_exist_refuses_every_host():
    body = defn(networkPolicy={'extends': ['corp-default']})
    assert network.command_denied(body, 'builder', ['curl', 'https://api.example.com/v1']) is not None


def test_an_mcp_server_starts_with_a_clean_environment_and_a_timeout(monkeypatch, tmp_path):
    monkeypatch.setenv('OH_SIDECAR_TOKEN_FOR_TEST', 'should-not-leak')
    leak = tmp_path / 'env.json'
    script = ('import json,os,sys\n'
              f'open({str(leak)!r},"w").write(json.dumps(dict(os.environ)))\n'
              'for line in sys.stdin:\n'
              '    msg=json.loads(line)\n'
              '    if "id" not in msg: continue\n'
              '    r={"protocolVersion":"2024-11-05","capabilities":{}} if msg["method"]=="initialize" else {"tools":[{"name":"docs"}]}\n'
              '    sys.stdout.write(json.dumps({"jsonrpc":"2.0","id":msg["id"],"result":r})+"\\n"); sys.stdout.flush()\n')
    body = defn(mcp={'docs': {'command': sys.executable, 'args': ['-c', script]}})
    body['agents']['builder']['mcp'] = ['docs']
    assert anyio.run(agent_mcp.tools_for, body, 'builder') == ['docs']
    assert 'OH_SIDECAR_TOKEN_FOR_TEST' not in json.loads(leak.read_text())

    silent = defn(mcp={'quiet': {'command': sys.executable, 'args': ['-c', 'import time; time.sleep(60)']}})
    silent['agents']['builder']['mcp'] = ['quiet']
    monkeypatch.setattr(agent_mcp, 'REQUEST_TIMEOUT_S', 1)
    with pytest.raises(runner.RunnerError):
        anyio.run(agent_mcp.tools_for, silent, 'builder')


def test_an_mcp_answer_for_another_request_or_with_odd_names_is_refused():
    def handler(method, params):
        if method == 'initialize':
            return {'jsonrpc': '2.0', 'id': 1, 'result': {}}
        return {'jsonrpc': '2.0', 'id': 99, 'result': {'tools': [{'name': 'docs'}]}}
    with pytest.raises(runner.RunnerError):
        anyio.run(agent_mcp.list_tools, agent_mcp.MemoryTransport(handler, check_ids=True))

    def odd(method, params):
        if method == 'initialize':
            return {'jsonrpc': '2.0', 'result': {}}
        return {'jsonrpc': '2.0', 'result': {'tools': [{'name': 'ok-tool'}, {'name': 'x' * 500}, {'name': 'bad\nname'}] + [{'name': f't{i}'} for i in range(300)]}}
    names = anyio.run(agent_mcp.list_tools, agent_mcp.MemoryTransport(odd))
    assert 'ok-tool' in names and all(len(name) <= 100 and '\n' not in name for name in names) and len(names) <= agent_mcp.MAX_TOOLS


def test_an_agent_naming_a_runner_that_does_not_exist_is_invalid():
    from factory.definition import _semantic_issues
    body = defn()
    body.update({'tiers': {}, 'defaults': {}, 'stages': {}, 'skills': {}, 'mcp': {}, 'reserved': {'automations': {}, 'webhooks': {}}})
    body['agents']['builder']['runner'] = 'ghost'
    body['agents']['builder']['localSkills'] = {}
    assert any(issue.path == 'agents.builder.runner' for issue in _semantic_issues(body))


@pytest.mark.parametrize('argv', [
    ['curl', 'https://api.example.com/a https://evil.example.net/b'],
    ['sh', '-c', 'curl https://api.example.com/ok; curl https://evil.example.net/x'],
    ['bash', '-c', 'echo hi && wget evil.example.net/x'],
    ['curl', '--proxy', 'http://api.example.com:3128', 'https://api.example.com/'],
    ['curl', '-x', 'api.example.com:3128', 'https://api.example.com/'],
    ['curl', '--resolve', 'api.example.com:443:203.0.113.7', 'https://api.example.com/'],
    ['curl', '--connect-to', 'api.example.com:443:evil.example.net:443', 'https://api.example.com/'],
    ['ssh', '-o', 'ProxyCommand=nc evil.example.net 22', 'git@api.example.com'],
    ['ssh', '-J', 'jump.example.net', 'git@api.example.com'],
])
def test_every_host_and_every_redirect_is_judged(argv):
    assert network.command_denied(defn(), 'builder', argv) is not None, argv


@pytest.mark.parametrize('url', ['http://3405803783/', 'http://0xcb.0.113.7/', 'http://0313.0.0161.7/', 'http://[::ffff:203.0.113.7]/'])
def test_a_denied_address_in_another_spelling_is_still_denied(url):
    body = defn(networkPolicy={'deniedHosts': ['203.0.113.7']})
    assert network.command_denied(body, 'builder', ['curl', url]) is not None, url


def test_a_denied_name_written_in_unicode_is_still_denied():
    body = defn(networkPolicy={'deniedHosts': ['xn--bcher-kva.example']})
    assert network.command_denied(body, 'builder', ['curl', 'https://bücher.example/']) is not None


def test_a_local_test_command_is_still_local():
    assert network.command_denied(defn(), 'builder', ['sh', '-c', 'python -m pytest tests && echo done']) is None
    assert network.command_denied(defn(), 'builder', ['sed', '-e', 's/a/b/', 'notes.md']) is None
    assert network.command_denied(defn(), 'builder', ['make', '-j', '4']) is None
    assert network.command_denied(defn(), 'builder', ['git', '-c', 'http.proxy=http://api.example.com:1', 'fetch']) is not None


@pytest.mark.parametrize('argv', [
    ['curl', 'https://api.example.com"@evil.example.net/'],
    ['curl', "https://api.example.com'@evil.example.net/"],
    ['sh', '-c', 'curl https://ev""il.example.net/'],
    ['sh', '-c', 'curl https://$HOST/'],
    ['sh', '-c', 'curl https://`echo evil.example.net`/'],
    ['bash', '-c', 'curl https://ev\\il.example.net/'],
    ['curl', 'https://%65vil.example.net/'],
    ['curl', 'https://ａpi.example.com/'],
    ['curl', 'https://bücher.example/'],
])
def test_what_the_policy_cannot_read_safely_is_refused(argv):
    assert network.command_denied(defn(), 'builder', argv) is not None, argv


def test_an_allowed_url_inside_a_plain_shell_payload_still_passes():
    assert network.command_denied(defn(), 'builder', ['sh', '-c', 'curl https://api.example.com/v1 && echo ok']) is None


@pytest.mark.parametrize('argv', [
    ['env', 'sh', '-c', 'curl https://$H/'],
    ['timeout', '5', 'bash', '-c', 'curl https://`h`/'],
    ['sudo', 'sh', '-c', 'curl "https://api.example.com"@evil.example.net'],
    ['busybox', 'sh', '-c', 'wget https://$H/'],
    ['cmd', '/c', 'curl https://%H%/'],
    ['cmd', '/c', 'curl https://ev^il.example.net/'],
    ['pwsh', '-c', 'curl ("https://ev" + "il.example.net/")'],
    ['python', '-c', 'import urllib.request as u; u.urlopen("https://bücher.example/")'],
    ['python', 'fetch.py', 'https://%65vil.example.net/'],
])
def test_wrappers_other_shells_and_any_program_are_held_to_the_same_refusals(argv):
    assert network.command_denied(defn(), 'builder', argv) is not None, argv


def test_a_policy_entry_written_in_unicode_closes_a_deny_list_too():
    body = defn(networkPolicy={'deniedHosts': ['bücher.example']})
    assert network.command_denied(body, 'builder', ['curl', 'https://xn--bcher-kva.example/']) is not None


def test_a_wrapped_local_command_without_special_characters_passes():
    assert network.command_denied(defn(), 'builder', ['timeout', '60', 'python', '-m', 'pytest', 'tests']) is None


@pytest.mark.parametrize('argv', [
    ['curl', 'https://api.example.com,evil.example.net/'],
    ['curl', 'https://{api.example.com,evil.example.net}/'],
    ['curl', 'https://[api.example.com]/'],
    ['sh', '-c', 'curl https://ev?l.example.net/'],
    ['python', 'fetch.py', 'https://$H/'],
    ['python', 'fetch.py', 'deploy@`h`'],
    ['pwsh', '-c', 'Invoke-WebRequest https://api.example.com/'],
])
def test_a_host_outside_the_strict_grammar_or_a_powershell_payload_is_refused(argv):
    assert network.command_denied(defn(), 'builder', argv) is not None, argv


def test_a_policy_entry_that_is_not_ascii_closes_the_policy():
    body = defn(networkPolicy={'allowedHosts': ['bücher.example']})
    assert network.command_denied(body, 'builder', ['curl', 'https://xn--bcher-kva.example/']) is not None


def test_a_plain_allowed_url_with_a_port_and_an_ipv6_literal_still_parse():
    body = defn(networkPolicy={'allowedHosts': ['api.example.com', '2001:db8::1']})
    assert network.command_denied(body, 'builder', ['curl', 'https://api.example.com:8443/v1']) is None
    assert network.command_denied(body, 'builder', ['curl', 'https://[2001:db8::1]:443/']) is None
