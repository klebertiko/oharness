"""The chat agent gets the `cordis_plugins` tool and the plugin skill only while creator mode is on, and each action waits for the person."""
from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from adapters.base import AdapterConfig
from adapters.openai_compatible import OpenAICompatibleAdapter
from cordis import creator
from cordis.service import CordisService
from engine import RunControl
from sandbox.broker import ToolBroker
from sandbox.schemas import ToolsRequest


def sse(chunks):
    return httpx.Response(200, text=''.join('data: ' + json.dumps(c) + '\n\n' for c in chunks) + 'data: [DONE]\n\n')


def call_chunks(args):
    return [{'choices': [{'delta': {'tool_calls': [{'index': 0, 'id': 'c1', 'type': 'function',
                                                    'function': {'name': 'cordis_plugins', 'arguments': json.dumps(args)}}]}}]},
            {'choices': [], 'usage': {'total_tokens': 3}}]


DONE = [{'choices': [{'delta': {'content': 'ok'}}]}, {'choices': [], 'usage': {'total_tokens': 2}}]


@pytest.fixture()
def service(tmp_path):
    service = CordisService(tmp_path, enabled=False)
    creator.bind(service)
    yield service
    creator.bind(None)


THREAD = 'chat-1'


def run(root, args, decision, *, mode='ask', options=None):
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        return sse(call_chunks(args)) if len(requests) == 1 else sse(DONE)

    control = RunControl('cordis-chat')
    broker = ToolBroker(str(root) if root else None, 'ollama', control, options or ToolsRequest(thread_id=THREAD), permission_mode=mode,
                        creator_thread=THREAD)
    adapter = OpenAICompatibleAdapter(transport=httpx.MockTransport(handler))
    config = AdapterConfig(adapter='ollama', model='test', endpoint='http://fake/v1')

    async def collect():
        events = []
        async for event in broker.stream('make a plugin', adapter, config):
            events.append(event)
            if event['kind'] == 'tool_approval_required':
                control.tool_approval.decide(event['call_id'], decision, 'checked')
        return events
    return asyncio.run(collect()), requests


def test_without_creator_mode_the_tool_is_not_offered(tmp_path, service):
    _, requests = run(tmp_path, {'action': 'list'}, 'approve', options=ToolsRequest(enabled=True))
    names = [t['function']['name'] for t in requests[0].get('tools') or []]
    assert 'cordis_plugins' not in names
    assert 'Cordis plugin development' not in requests[0]['messages'][0]['content']


def test_with_creator_mode_each_action_waits_for_approval_and_returns_status_and_next_step(service):
    service.set_creator(THREAD, True)
    events, requests = run(None, {'action': 'scaffold', 'name': 'from-chat', 'kind': 'tool'}, 'approve')
    assert [t['function']['name'] for t in requests[0]['tools']] == ['cordis_plugins']
    assert 'Cordis plugin development' in requests[0]['messages'][0]['content']
    kinds = [e['kind'] for e in events if e['kind'].startswith('tool_') and e['kind'] != 'tool_budget']
    assert kinds == ['tool_call', 'tool_approval_required', 'tool_approval_decision', 'tool_result']
    asked = next(e for e in events if e['kind'] == 'tool_approval_required')
    assert asked['name'] == 'cordis_plugins' and asked['reason'] == 'cordis_plugins'
    result = json.loads(next(e for e in events if e['kind'] == 'tool_result')['result'])
    assert result['status'] == 'applied' and result['nextStep']
    assert (service.dev.root / 'from-chat' / 'package.json').is_file()
    assert '&quot;status&quot;: &quot;applied&quot;' in requests[1]['messages'][-1]['content']  # escaped as tool data


def test_a_rejected_action_does_nothing(service):
    service.set_creator(THREAD, True)
    events, _ = run(None, {'action': 'scaffold', 'name': 'not-this', 'kind': 'tool'}, 'reject')
    assert next(e for e in events if e['kind'] == 'tool_denied')['reason'] == 'rejected'
    assert not (service.dev.root / 'not-this').exists()


def test_plan_mode_refuses_the_tool(service):
    service.set_creator(THREAD, True)
    events, _ = run(None, {'action': 'scaffold', 'name': 'in-plan', 'kind': 'tool'}, 'approve', mode='plan')
    assert next(e for e in events if e['kind'] == 'tool_denied')['reason'] == 'policy'
    assert not any(e['kind'] == 'tool_approval_required' for e in events)
    assert not (service.dev.root / 'in-plan').exists()


def test_bad_arguments_are_refused_before_approval(service):
    service.set_creator(THREAD, True)
    events, _ = run(None, {'action': 'write_file', 'name': 'x', 'path': '../escape', 'content': ''}, 'approve')
    result = json.loads(next(e for e in events if e['kind'] == 'tool_result')['result'])
    assert result['status'] == 'failed' and result['error'] in ('invalid_path', 'not_found')
    assert not any(e['kind'] == 'tool_approval_required' for e in events)


def test_a_chat_turn_without_tools_gets_the_broker_only_in_creator_mode(tmp_path):
    from fastapi.testclient import TestClient

    from main import app

    def capabilities_sent(client, thread=THREAD):
        body = {'instruction': 'hello', 'mode': 'mock', 'cwd': str(tmp_path), 'creator_thread_id': thread}
        text = client.post('/execute/direct', json=body).text
        return 'event: capabilities' in text

    with TestClient(app) as client:
        client.post('/cowork/projects', json={'name': 'Creator', 'rootPath': str(tmp_path)})
        service = app.state.cordis
        if service is None:
            pytest.skip('the sidecar started without the plugin manager')
        before = service.creator_on(THREAD)
        try:
            service.set_creator(THREAD, False)
            assert capabilities_sent(client) is False
            service.set_creator(THREAD, True)
            assert capabilities_sent(client) is True
            assert capabilities_sent(client, 'chat-2') is False  # another thread: no creator tool
            plain = client.post('/execute/direct', json={'instruction': 'x', 'mode': 'mock', 'cwd': str(tmp_path)}).text
            assert 'event: capabilities' not in plain
        finally:
            service.set_creator(THREAD, before)
