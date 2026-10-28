"""#164: POST /execute/direct honours `max_tokens` and journals `budget_exceeded`."""
from __future__ import annotations

import pytest

from adapters.base import AgentAdapter
from test_execution_budget_enforcement import _sse_events, client  # noqa: F401 -- fixture


class _Chatty(AgentAdapter):
    async def invoke(self, prompt, config):
        raise AssertionError

    async def stream(self, prompt, config):
        yield 'x'

    async def stream_events(self, prompt, config):
        for _ in range(50):
            yield {'kind': 'text', 'text': 'y' * 400}
        yield {'kind': 'usage', 'tokens': 5000}


@pytest.fixture(autouse=True)
def chatty(monkeypatch, client):
    monkeypatch.setattr('routers.execution.get_adapter', lambda name: _Chatty())
    monkeypatch.setattr('providers.resolution.get_adapter', lambda name: _Chatty())


def _direct(client, **extra):
    return client.post('/execute/direct', json={'instruction': 'hi', 'mode': 'live',
                                                 'connection_id': 'anthropic', 'model': 'claude-sonnet-5', **extra})


def test_ceiling_reached_ends_run_with_explicit_status_in_journal(client):
    resp = _direct(client, max_tokens=500)
    assert resp.status_code == 200
    events = dict(_sse_events(resp.text))
    assert events['budget_exceeded']['max_tokens'] == 500
    assert 500 <= events['budget_exceeded']['used_tokens'] < 2000
    assert events['harness_done']['status'] == 'budget_exceeded'
    run_id = resp.headers['X-Execution-Id']
    detail = client.get(f'/execute/logs/{run_id}').json()
    assert detail['status'] == 'budget_exceeded'
    journal = client.get(f'/execute/logs/{run_id}/events').json()
    assert any(e['event'] == 'budget_exceeded' for e in (journal['events'] if isinstance(journal, dict) else journal))


def test_run_under_the_ceiling_completes(client):
    events = dict(_sse_events(_direct(client, max_tokens=1_000_000).text))
    assert 'budget_exceeded' not in events and events['harness_done']['status'] == 'complete'


def test_invalid_ceiling_is_refused(client):
    assert _direct(client, max_tokens=5).status_code == 400
    assert _direct(client, max_tokens=True).status_code in (400, 422)

