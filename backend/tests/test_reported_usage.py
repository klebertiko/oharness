"""#340: the provider's own usage report wins over the chars/4 estimate, for harness nodes, simple turns and subagents."""
from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from adapters.base import AdapterConfig, AgentAdapter
from adapters.openai_compatible import OpenAICompatibleAdapter
from test_execution_budget_enforcement import _sse_events, client  # noqa: F401 -- fixture


def _sse(*chunks):
    return ''.join(f'data: {json.dumps(c)}\n\n' for c in chunks) + 'data: [DONE]\n\n'


def _adapter(body, seen):
    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, text=body, headers={'content-type': 'text/event-stream'})
    return OpenAICompatibleAdapter(transport=httpx.MockTransport(handler))


def _events(adapter):
    config = AdapterConfig(adapter='openai', model='m', endpoint='http://fake/v1', api_key='')

    async def go():
        return [event async for event in adapter.stream_events('hello', config)]
    return asyncio.run(go())


def test_stream_events_asks_for_and_reports_the_providers_usage():
    seen = []
    body = _sse({'choices': [{'delta': {'content': 'hi'}}]},
                {'choices': [], 'usage': {'prompt_tokens': 100, 'completion_tokens': 20, 'total_tokens': 120}})
    events = _events(_adapter(body, seen))
    assert seen[0]['stream_options'] == {'include_usage': True}
    assert [e['text'] for e in events if e['kind'] == 'text'] == ['hi']
    assert [e['tokens'] for e in events if e['kind'] == 'usage'] == [120]


def test_stream_events_sums_prompt_and_completion_when_there_is_no_total():
    body = _sse({'choices': [{'delta': {'content': 'hi'}}]}, {'choices': [], 'usage': {'prompt_tokens': 7, 'completion_tokens': 3}})
    assert [e['tokens'] for e in _events(_adapter(body, [])) if e['kind'] == 'usage'] == [10]


def test_without_a_usage_report_no_usage_event_is_made_up():
    body = _sse({'choices': [{'delta': {'content': 'hi'}}]})
    assert not [e for e in _events(_adapter(body, [])) if e['kind'] == 'usage']


class _Reporting(AgentAdapter):
    """A provider that answers briefly but reports a large usage (the prompt counts)."""

    async def invoke(self, prompt, config):
        raise AssertionError

    async def stream(self, prompt, config):
        yield 'x'

    async def stream_events(self, prompt, config):
        yield {'kind': 'text', 'text': 'short answer'}
        yield {'kind': 'usage', 'tokens': 120}


@pytest.fixture
def reporting(monkeypatch, client):
    monkeypatch.setattr('routers.execution.get_adapter', lambda name: _Reporting())
    monkeypatch.setattr('providers.resolution.get_adapter', lambda name: _Reporting())


def _direct(client, **extra):
    return client.post('/execute/direct', json={'instruction': 'hi', 'mode': 'live', 'connection_id': 'anthropic',
                                                 'model': 'claude-sonnet-5', **extra})


def test_the_ceiling_fires_on_the_reported_usage_of_a_simple_turn(client, reporting):
    events = dict(_sse_events(_direct(client, max_tokens=100).text))
    assert events['budget_exceeded']['used_tokens'] == 120
    assert events['harness_done']['status'] == 'budget_exceeded'
    assert events['harness_done']['total_tokens'] == 120 and events['node_done']['tokens_estimated'] is False


def test_a_report_under_the_ceiling_completes_and_is_the_total(client, reporting):
    events = dict(_sse_events(_direct(client, max_tokens=1000).text))
    assert 'budget_exceeded' not in events and events['harness_done']['status'] == 'complete'
    assert events['harness_done']['total_tokens'] == 120


class _Chatty(AgentAdapter):
    async def invoke(self, prompt, config):
        raise AssertionError

    async def stream(self, prompt, config):
        yield 'x'

    async def stream_events(self, prompt, config):
        for _ in range(50):
            yield {'kind': 'text', 'text': 'y' * 398}


def test_one_turn_one_count_when_the_estimate_stops_the_stream(client, monkeypatch):
    monkeypatch.setattr('routers.execution.get_adapter', lambda name: _Chatty())
    monkeypatch.setattr('providers.resolution.get_adapter', lambda name: _Chatty())
    events = dict(_sse_events(_direct(client, max_tokens=100).text))
    assert events['harness_done']['total_tokens'] == events['budget_exceeded']['used_tokens']


def test_subagent_spend_is_the_providers_report_through_the_real_adapter(tmp_path):
    from engine import RunControl
    from sandbox.broker import ToolBroker
    from sandbox.schemas import ToolsRequest

    def handler(request):
        payload = json.loads(request.content)
        replayed = any(m.get('role') == 'tool' for m in payload['messages'])
        if not payload.get('tools'):  # a child: no tools
            body = _sse({'choices': [{'delta': {'content': 'child says hi'}}]}, {'choices': [], 'usage': {'total_tokens': 120}})
        elif replayed:
            body = _sse({'choices': [{'delta': {'content': 'done'}}]}, {'choices': [], 'usage': {'total_tokens': 50}})
        else:
            call = {'index': 0, 'id': 'k0', 'function': {'name': 'run_subagent', 'arguments': json.dumps({'task': 'alpha'})}}
            body = _sse({'choices': [{'delta': {'tool_calls': [call]}}]}, {'choices': [], 'usage': {'total_tokens': 30}})
        return httpx.Response(200, text=body, headers={'content-type': 'text/event-stream'})

    adapter = OpenAICompatibleAdapter(transport=httpx.MockTransport(handler))
    config = AdapterConfig(adapter='ollama', model='m', endpoint='http://fake/v1')
    broker = ToolBroker(str(tmp_path), 'ollama', RunControl('usage-sub'), ToolsRequest(enabled=True, subagents=True))

    async def go():
        return [event async for event in broker.stream('go', adapter, config)]
    events = asyncio.run(go())
    assert next(e for e in events if e['kind'] == 'subagent_done')['tokens'] == 120
    assert [e for e in events if e['kind'] == 'usage'][-1]['tokens'] == 30 + 120 + 50
