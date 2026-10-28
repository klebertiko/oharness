"""#164: per-run token ceiling (`budget_exceeded`) and compaction events."""
import asyncio
import json

import httpx
import pytest

from adapters.base import AdapterConfig
from adapters.openai_compatible import OpenAICompatibleAdapter
from engine import RunControl
from run_budget import RUN_BUDGET_RULES, STATUS_BUDGET_EXCEEDED, RunBudget, compact_messages, estimate_tokens, validate_max_tokens
from sandbox.broker import ToolBroker
from sandbox.schemas import ToolsRequest


def sse(chunks):
    return httpx.Response(200, text=''.join('data: ' + json.dumps(c) + '\n\n' for c in chunks) + 'data: [DONE]\n\n')


def tool_turn(tokens, path='README.md'):
    args = json.dumps({'path': path})
    return sse([{'choices': [{'delta': {'tool_calls': [{'index': 0, 'id': 'c1', 'type': 'function',
                'function': {'name': 'read_file', 'arguments': args}}]}}]},
                {'choices': [], 'usage': {'total_tokens': tokens}}])


def run_broker(tmp_path, handler, **kw):
    adapter = OpenAICompatibleAdapter(transport=httpx.MockTransport(handler))
    broker = ToolBroker(str(tmp_path), 'ollama', RunControl('t'), ToolsRequest(enabled=True), **kw)
    config = AdapterConfig(adapter='ollama', model='m', endpoint='http://fake/v1')

    async def go():
        return [e async for e in broker.stream('inspect', adapter, config)]
    return asyncio.run(go())


def test_rules_table_is_the_single_source_of_limits():
    assert validate_max_tokens(None) is None
    assert validate_max_tokens(RUN_BUDGET_RULES['max_tokens']['min']) == RUN_BUDGET_RULES['max_tokens']['min']
    for bad in (0, -5, RUN_BUDGET_RULES['max_tokens']['max'] + 1, True, 1.5, '10'):
        with pytest.raises(ValueError):
            validate_max_tokens(bad)


def test_budget_stops_the_loop_with_explicit_event(tmp_path):
    (tmp_path / 'README.md').write_text('x')
    calls = []

    def handler(request):
        calls.append(1)
        return tool_turn(600)
    events = run_broker(tmp_path, handler, run_budget=RunBudget(max_tokens=1000))
    exceeded = [e for e in events if e['kind'] == 'budget_exceeded']
    assert len(exceeded) == 1
    assert exceeded[0]['max_tokens'] == 1000 and exceeded[0]['used_tokens'] >= 1000
    assert len(calls) == 2  # third provider turn never starts


def test_no_ceiling_means_no_event(tmp_path):
    (tmp_path / 'README.md').write_text('x')
    n = []

    def handler(request):
        n.append(1)
        return tool_turn(10) if len(n) < 3 else sse([{'choices': [{'delta': {'content': 'ok'}}]}])
    events = run_broker(tmp_path, handler)
    assert not [e for e in events if e['kind'] == 'budget_exceeded']


def test_compaction_reports_before_and_after_tokens():
    messages = [{'role': 'system', 'content': 's'}, {'role': 'user', 'content': 'u'}]
    for i in range(4):
        messages.append({'role': 'assistant', 'content': None, 'tool_calls': []})
        messages.append({'role': 'tool', 'tool_call_id': str(i), 'content': 'z' * 4000})
    before = estimate_tokens(messages)
    result = compact_messages(messages, trigger_tokens=1000)
    assert result is not None
    new, info = result
    assert info['before_tokens'] == before and info['after_tokens'] == estimate_tokens(new) < before
    assert new[-1]['content'] == messages[-1]['content']  # current turn's result is unread: kept
    assert new[-3]['content'].startswith('[compacted')
    assert compact_messages(new, trigger_tokens=10**6) is None


def test_broker_emits_context_compacted(tmp_path):
    (tmp_path / 'README.md').write_text('y' * 20000)
    n = []

    def handler(request):
        n.append(1)
        return tool_turn(5) if len(n) < 4 else sse([{'choices': [{'delta': {'content': 'done'}}]}])
    events = run_broker(tmp_path, handler, compact_at=2000)
    compact = [e for e in events if e['kind'] == 'context_compacted']
    assert compact and all(e['after_tokens'] < e['before_tokens'] for e in compact)


def test_status_constant():
    assert STATUS_BUDGET_EXCEEDED == 'budget_exceeded'


def test_finished_turn_over_the_ceiling_is_not_relabelled(tmp_path):
    events = run_broker(tmp_path, lambda r: sse([{'choices': [{'delta': {'content': 'done'}}]},
                                                  {'choices': [], 'usage': {'total_tokens': 5000}}]),
                        run_budget=RunBudget(max_tokens=1000))
    assert not [e for e in events if e['kind'] == 'budget_exceeded']


def test_compaction_never_stubs_the_current_turns_results():
    messages = [{'role': 'user', 'content': 'u'}, {'role': 'assistant', 'content': None, 'tool_calls': []}]
    messages += [{'role': 'tool', 'tool_call_id': str(i), 'content': 'z' * 4000} for i in range(5)]
    assert compact_messages(messages, trigger_tokens=100) is None
