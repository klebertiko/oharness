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
    '    result = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}} if msg.get("method") == "initialize" else {"tools": [{"name": "docs"}]}\n'
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
