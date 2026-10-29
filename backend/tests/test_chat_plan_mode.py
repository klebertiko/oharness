"""Plan mode (#162): nothing mutable runs, the run ends in a plan artifact, and nothing executes before it is approved."""
import json

import pytest
from fastapi.testclient import TestClient

from main import app

import uuid

THREAD = 'thread-plan'


def sse(response):
    return [{'event': block.splitlines()[0][7:], 'data': json.loads(block.splitlines()[1][6:])}
            for block in response.text.strip().split('\n\n') if block.startswith('event: ')]


@pytest.fixture(autouse=True)
def fresh_thread():
    """The sidecar database outlives a test: every test gets its own conversation."""
    global THREAD
    THREAD = 'thread-plan-' + uuid.uuid4().hex[:8]


@pytest.fixture()
def client(tmp_path):
    with TestClient(app) as client:
        client.post('/cowork/projects', json={'name': 'Plan', 'rootPath': str(tmp_path)})
        yield client


def set_mode(client, mode, thread=None):
    thread = thread or THREAD
    return client.put('/chat/tools/permission', json={'thread_id': thread, 'mode': mode})


def run(client, tmp_path, thread=None, instruction='Add a settings page', tools=None):
    thread = thread or THREAD
    body = {'instruction': instruction, 'mode': 'mock', 'cwd': str(tmp_path),
            'tools': {'enabled': False, 'thread_id': thread, **(tools or {})}}
    return sse(client.post('/execute/direct', json=body))


def plan_event(events):
    return next((e['data'] for e in events if e['event'] == 'plan_proposed'), None)


def current(client, thread=None):
    thread = thread or THREAD
    return client.get('/chat/tools/plan', params={'thread_id': thread}).json()


def test_a_plan_mode_run_ends_in_a_plan_artifact_that_is_waiting_for_approval(client, tmp_path):
    set_mode(client, 'plan')
    events = run(client, tmp_path)
    plan = plan_event(events)
    output = next(e['data'] for e in events if e['event'] == 'node_done')['output']
    assert plan['thread_id'] == THREAD and plan['status'] == 'proposed' and plan['text'] == output and plan['plan_id']
    # the artifact is the last thing the run says before it ends
    names = [e['event'] for e in events]
    assert names.index('plan_proposed') > names.index('node_done') and names.index('plan_proposed') < names.index('harness_done')
    assert current(client)['plan'] == {k: v for k, v in plan.items() if k != 'node_id'}


def test_other_modes_produce_no_plan(client, tmp_path):
    for mode in ('ask', 'auto_workspace', 'read_only', 'workspace_write'):
        set_mode(client, mode)
        assert plan_event(run(client, tmp_path)) is None
    assert current(client)['plan'] is None


def test_only_a_conversation_stored_in_plan_gets_a_plan_even_if_a_request_tightens_to_plan(client, tmp_path):
    # The barrier and the card both follow the stored mode, so a plan is only proposed where they can see it.
    set_mode(client, 'ask')
    assert plan_event(run(client, tmp_path, tools={'permission_mode': 'plan'})) is None


@pytest.mark.parametrize('preset', [{'name': 'read', 'path': 'README.md'}, {'name': 'discover'}, {'name': 'exec', 'argv': ['git', '--version']}])
def test_a_slash_preset_turn_is_not_a_plan(client, tmp_path, preset):
    (tmp_path / 'README.md').write_text('hi', encoding='utf-8')
    set_mode(client, 'plan')
    events = run(client, tmp_path, tools={'enabled': True, 'summarize': True, 'preset': preset})
    assert plan_event(events) is None
    assert current(client)['plan'] is None
    assert set_mode(client, 'ask').status_code == 200  # nothing waits for approval


def test_in_plan_mode_no_command_runs_and_the_refusal_says_so(client, tmp_path):
    set_mode(client, 'plan')
    marker = tmp_path / 'ran'
    events = run(client, tmp_path, tools={'enabled': True, 'summarize': False,
                                          'preset': {'name': 'exec', 'argv': ['touch', str(marker)]}})
    assert any(e['event'] == 'tool_denied' for e in events)
    assert not any(e['event'] in {'tool_result', 'tool_auto_approved', 'tool_approval_required'} for e in events)
    assert not marker.exists()


def test_the_mode_cannot_leave_plan_while_a_plan_waits_for_approval(client, tmp_path):
    set_mode(client, 'plan')
    run(client, tmp_path)
    for mode in ('ask', 'auto_workspace', 'read_only', 'workspace_write', 'full'):
        response = set_mode(client, mode)
        assert response.status_code == 409 and response.json()['error'] == 'plan_not_approved'
    assert client.get('/chat/tools/permission', params={'thread_id': THREAD}).json()['mode'] == 'plan'
    assert set_mode(client, 'plan').status_code == 200


def test_approving_the_plan_leaves_plan_mode_in_ask_and_records_it(client, tmp_path):
    set_mode(client, 'plan')
    plan = plan_event(run(client, tmp_path))
    response = client.post('/chat/tools/plan/approve', json={'thread_id': THREAD, 'plan_id': plan['plan_id']})
    assert response.status_code == 200
    assert response.json() == {'thread_id': THREAD, 'plan_id': plan['plan_id'], 'status': 'approved', 'mode': 'ask'}
    assert client.get('/chat/tools/permission', params={'thread_id': THREAD}).json()['mode'] == 'ask'
    assert current(client)['plan'] is None
    assert set_mode(client, 'auto_workspace').status_code == 200


def test_a_plan_is_approved_once(client, tmp_path):
    set_mode(client, 'plan')
    plan = plan_event(run(client, tmp_path))
    body = {'thread_id': THREAD, 'plan_id': plan['plan_id']}
    assert client.post('/chat/tools/plan/approve', json=body).status_code == 200
    again = client.post('/chat/tools/plan/approve', json=body)
    assert again.status_code == 409 and again.json()['error'] == 'plan_not_proposed'


@pytest.mark.parametrize('payload', [{'mode': 'plan'}, {'mode': 'bypass'}, {'mode': 'full'}, {'mode': None}, {'extra': 1}])
def test_approval_can_only_choose_a_non_plan_mode_below_full_and_nothing_else(client, tmp_path, payload):
    set_mode(client, 'plan')
    plan = plan_event(run(client, tmp_path))
    response = client.post('/chat/tools/plan/approve', json={'thread_id': THREAD, 'plan_id': plan['plan_id'], **payload})
    assert response.status_code == 400 and response.json()['error'] == 'invalid_argument'
    assert client.get('/chat/tools/permission', params={'thread_id': THREAD}).json()['mode'] == 'plan'


def test_approval_may_pick_the_mode_the_work_continues_in(client, tmp_path):
    set_mode(client, 'plan')
    plan = plan_event(run(client, tmp_path))
    response = client.post('/chat/tools/plan/approve', json={'thread_id': THREAD, 'plan_id': plan['plan_id'], 'mode': 'workspace_write'})
    assert response.json()['mode'] == 'workspace_write'


def test_a_plan_belongs_to_its_thread(client, tmp_path):
    set_mode(client, 'plan')
    plan = plan_event(run(client, tmp_path))
    response = client.post('/chat/tools/plan/approve', json={'thread_id': 'someone-else', 'plan_id': plan['plan_id']})
    assert response.status_code == 404
    assert client.get('/chat/tools/permission', params={'thread_id': THREAD}).json()['mode'] == 'plan'


def test_discarding_keeps_plan_mode_and_frees_the_mode_selector(client, tmp_path):
    set_mode(client, 'plan')
    plan = plan_event(run(client, tmp_path))
    response = client.post('/chat/tools/plan/discard', json={'thread_id': THREAD, 'plan_id': plan['plan_id']})
    assert response.status_code == 200 and response.json()['status'] == 'discarded'
    assert client.get('/chat/tools/permission', params={'thread_id': THREAD}).json()['mode'] == 'plan'
    assert current(client)['plan'] is None
    assert set_mode(client, 'ask').status_code == 200


def test_a_new_plan_supersedes_the_waiting_one(client, tmp_path):
    set_mode(client, 'plan')
    first = plan_event(run(client, tmp_path))
    second = plan_event(run(client, tmp_path, instruction='Rethink it'))
    assert current(client)['plan']['plan_id'] == second['plan_id']
    stale = client.post('/chat/tools/plan/approve', json={'thread_id': THREAD, 'plan_id': first['plan_id']})
    assert stale.status_code == 409 and stale.json()['error'] == 'plan_not_proposed'


def test_the_plan_artifact_is_recorded_in_the_run_history(client, tmp_path):
    set_mode(client, 'plan')
    response = client.post('/execute/direct', json={'instruction': 'Plan it', 'mode': 'mock', 'cwd': str(tmp_path),
                                                    'tools': {'enabled': False, 'thread_id': THREAD}})
    history = client.get('/execute/logs/' + response.headers['x-execution-id']).json()
    assert 'plan_proposed' in [e['event'] for e in history['result']['events']]


def test_when_the_plan_cannot_be_saved_the_run_says_so_and_nothing_is_left_waiting(client, tmp_path, monkeypatch):
    from routers import execution

    async def broken(*_args, **_kwargs):
        raise RuntimeError('database is locked')
    monkeypatch.setattr(execution, 'propose_plan', broken)
    set_mode(client, 'plan')
    events = run(client, tmp_path)
    assert plan_event(events) is None
    error = next(e['data'] for e in events if e['event'] == 'plan_error')
    assert error['code'] == 'plan_not_saved' and 'database is locked' not in json.dumps(error)  # no internals leak to the screen
    done = next(e['data'] for e in events if e['event'] == 'harness_done')
    assert done['status'] == 'complete'  # the answer was delivered; only the approval card is missing
    assert current(client)['plan'] is None
    assert set_mode(client, 'ask').status_code == 200  # nothing blocks leaving Plan
