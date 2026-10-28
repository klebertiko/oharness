"""Resume and fork a run from the durable journal: the old events are read, never rewritten."""
import json

from fastapi.testclient import TestClient

from main import app
from test_run_store import start_stream


def partial_run():
    """A run cut off after its first events (the client went away): committed events, coverage `partial`."""
    with TestClient(app) as client:
        response = client.portal.call(start_stream, 'direct')
        run_id = response.headers['X-Execution-Id']
        client.portal.call(anext, response.body_iterator)
        client.portal.call(response.body_iterator.aclose)
    return run_id


def events_of(client, run_id):
    return client.get(f'/execute/logs/{run_id}/events?limit=500').json()['events']


def test_a_partial_run_reopens_after_a_restart_with_every_event_up_to_the_last_sequence():
    run_id = partial_run()
    with TestClient(app) as reopened:  # the sidecar starts again: recover_interrupted runs
        detail = reopened.get(f'/execute/logs/{run_id}').json()
        assert detail['status'] == 'interrupted' and detail['coverage'] == 'partial'
        events = events_of(reopened, run_id)
        assert detail['last_sequence'] == len(events) >= 1
        assert [e['sequence'] for e in events] == list(range(1, detail['last_sequence'] + 1))
        assert detail['resumable'] is True and detail['continued_from'] is None


def test_continuing_creates_a_linked_run_and_leaves_the_old_journal_untouched():
    run_id = partial_run()
    with TestClient(app) as client:
        before = events_of(client, run_id)
        last = client.get(f'/execute/logs/{run_id}').json()['last_sequence']
        made = client.post(f'/execute/logs/{run_id}/continue')
        assert made.status_code == 201
        child = made.json()
        assert child['id'] != run_id and child['continued_from'] == run_id and child['parent_sequence'] == last
        assert events_of(client, run_id) == before  # not rewritten, not extended

        detail = client.get(f'/execute/logs/{child["id"]}').json()
        assert detail['continued_from'] == run_id and detail['parent_sequence'] == last
        first = events_of(client, child['id'])[0]
        assert first['sequence'] == 1 and first['event'] == 'run_continued'
        assert first['data'] == {'from_run_id': run_id, 'from_sequence': last}
        assert client.get(f'/execute/logs/{run_id}').json()['continuations'] == [child['id']]


def test_a_run_can_be_forked_more_than_once():
    run_id = partial_run()
    with TestClient(app) as client:
        a = client.post(f'/execute/logs/{run_id}/continue').json()['id']
        b = client.post(f'/execute/logs/{run_id}/continue').json()['id']
        assert a != b
        assert sorted(client.get(f'/execute/logs/{run_id}').json()['continuations']) == sorted([a, b])


def test_only_a_partial_run_that_is_no_longer_running_can_be_continued():
    with TestClient(app) as client:
        done = client.post('/execute/direct', json={'instruction': 'hello', 'mode': 'mock'}).headers['X-Execution-Id']
        assert client.get(f'/execute/logs/{done}').json()['resumable'] is False
        refused = client.post(f'/execute/logs/{done}/continue')
        assert refused.status_code == 409 and refused.json()['detail']['code'] == 'not_resumable'

        live = client.portal.call(start_stream, 'direct')
        live_id = live.headers['X-Execution-Id']
        client.portal.call(anext, live.body_iterator)
        assert client.post(f'/execute/logs/{live_id}/continue').status_code == 409  # still running
        client.portal.call(live.body_iterator.aclose)

        assert client.post('/execute/logs/does-not-exist/continue').status_code == 404


def test_a_legacy_log_without_a_journal_cannot_be_continued():
    import anyio

    from database import SessionLocal
    from models import ExecutionLog

    async def seed():
        async with SessionLocal() as db:
            row = ExecutionLog(harness_id='h', harness_name='H', status='interrupted', result_json=json.dumps({}))
            db.add(row)
            await db.commit()
            return row.id

    with TestClient(app) as client:
        legacy = anyio.run(seed)
        assert client.get(f'/execute/logs/{legacy}').json()['resumable'] is False
        assert client.post(f'/execute/logs/{legacy}/continue').status_code == 409
