"""Who may score, measure and decide, and what a proposal cannot carry. Each test is one way to bend the trial."""
from __future__ import annotations

import anyio
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from database import SessionLocal
from factory import auth, versions
from factory.definition import hash_of
from factory.improvement.orm import AppendOnlyError, FactoryFailure, FactoryScore, ImprovementEvent, ImprovementProposal
from forja_improvement_defs import FACTORY, HUMAN, definition
from main import app

OTHER = 'improve-other'


def _scorer() -> dict:
    return {auth.SCORER_HEADER: auth.scorer_credential()}


async def _reset():
    async with SessionLocal() as db:
        await db.execute(delete(ImprovementEvent))
        await db.execute(delete(ImprovementProposal))
        await db.execute(delete(FactoryScore))
        await db.execute(delete(FactoryFailure))
        await db.execute(delete(versions.DefinitionVersion).where(versions.DefinitionVersion.factory_id.in_((FACTORY, OTHER))))
        await db.commit()


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    monkeypatch.delenv('OH_FACTORY_DEV_HUMAN', raising=False)
    with TestClient(app) as test_client:
        anyio.run(_reset)
        yield test_client
    anyio.run(_reset)


def _activate(defn: dict, factory: str = FACTORY):
    async def go():
        async with SessionLocal() as db:
            await versions.activate(db, defn, hash_of(defn), 'local-user')
    anyio.run(go)


def _state(factory: str = FACTORY):
    async def go():
        async with SessionLocal() as db:
            return await versions.state(db, factory)
    return anyio.run(go)


def _canary(client) -> dict:
    _activate(definition())
    after = definition('Build the change, and ask a person when a check already failed.')
    proposal = client.post('/factory/improvements/analyze', json={'factory_id': FACTORY, 'after': after, 'justification': 'Ask.'}, headers=HUMAN).json()
    assert proposal['status'] == 'pending', proposal
    approved = client.post(f"/factory/improvements/{proposal['id']}/decide", json={'action': 'approve'}, headers=HUMAN)
    assert approved.status_code == 200, approved.text
    return proposal


def _score(client, version: str, run_id: str, passed: bool, headers=None, **extra):
    body = {'factory_id': FACTORY, 'version_hash': version, 'scorer_id': 'qa', 'run_id': run_id, 'passed': passed, **extra}
    return client.post('/factory/improvements/score', json=body, headers=_scorer() if headers is None else headers)


# ---------------------------------------------------------------------------------------------------------- scoring and measuring

def test_the_agent_token_cannot_measure_a_trial_or_force_its_rollback(client):
    proposal = _canary(client)
    for index in range(20):
        assert _score(client, proposal['after_hash'], f'bad-{index}', False).status_code == 200
    refused = client.post(f"/factory/improvements/{proposal['id']}/measure")
    assert refused.status_code == 403 and refused.json()['detail']['code'] == 'human_only'
    assert _state().canary is not None


def test_the_agent_token_cannot_record_a_score(client):
    proposal = _canary(client)
    refused = _score(client, proposal['after_hash'], 'forged', True, headers={})
    assert refused.status_code == 403 and refused.json()['detail']['code'] == 'scorer_only'
    assert _score(client, proposal['after_hash'], 'real', True).status_code == 200
    assert _score(client, proposal['after_hash'], 'by-hand', True, headers=HUMAN).status_code == 200


def test_a_score_names_the_active_or_the_trial_version_only(client):
    _canary(client)
    stray = _score(client, 'f' * 64, 'stray', False)
    assert stray.status_code == 409 and stray.json()['detail']['code'] == 'unknown_version'


def test_the_pass_line_and_the_labels_come_from_the_definition_not_the_caller(client):
    _activate(definition())
    version = hash_of(definition())
    for forged in ({'passing_score': 0}, {'labels': [{'value': 'tests-skipped', 'score': 1}]}, {'check': 'ci_failed'}):
        resp = client.post('/factory/improvements/score', json={'factory_id': FACTORY, 'version_hash': version, 'scorer_id': 'tests',
                                                                'run_id': 'r1', 'label': 'tests-skipped', **forged}, headers=_scorer())
        assert resp.status_code == 422, (forged, resp.text)
    partial = client.post('/factory/improvements/score', json={'factory_id': FACTORY, 'version_hash': version, 'scorer_id': 'tests',
                                                               'run_id': 'r2', 'label': 'tests-partial'}, headers=_scorer())
    assert partial.status_code == 200 and partial.json()['passed'] is False and partial.json()['score'] == 0.5
    unknown = client.post('/factory/improvements/score', json={'factory_id': FACTORY, 'version_hash': version, 'scorer_id': 'nope',
                                                               'run_id': 'r3', 'passed': True}, headers=_scorer())
    assert unknown.status_code == 404 and unknown.json()['detail']['code'] == 'unknown_scorer'
    deterministic = client.post('/factory/improvements/score', json={'factory_id': FACTORY, 'version_hash': version, 'scorer_id': 'qa',
                                                                     'run_id': 'r4', 'evidence': {'qa': 'rejected'}}, headers=_scorer())
    assert deterministic.status_code == 200 and deterministic.json()['passed'] is False


def test_scoring_again_keeps_the_earlier_result_and_its_failure(client):
    _activate(definition())
    version = hash_of(definition())
    assert _score(client, version, 'run-1', False, agent_id='builder').status_code == 200
    assert _score(client, version, 'run-1', True, agent_id='builder').status_code == 200

    async def rows():
        async with SessionLocal() as db:
            return (list(await db.scalars(select(FactoryScore).where(FactoryScore.run_id == 'run-1'))),
                    list(await db.scalars(select(FactoryFailure).where(FactoryFailure.run_id == 'run-1'))))
    scores, failures = anyio.run(rows)
    assert len(scores) == 2 and len(failures) == 1
    listed = client.get('/factory/improvements', params={'factory_id': FACTORY}).json()['failures']
    assert len(listed) == 1 and listed[0]['superseded'] is True
    waiting = client.post('/factory/improvements/run', json={'factory_id': FACTORY, 'force': True}, headers=HUMAN).json()
    assert waiting['started'] is False and waiting['open'] == 0


@pytest.mark.parametrize('bad', [
    {'score': float('nan')}, {'score': float('inf')}, {'score': -0.1}, {'score': 1.5},
    {'cost_tokens': -1}, {'interventions': -1}, {'run_id': '../../etc'}, {'run_id': 'x' * 300},
    {'agent_id': 'Not An Id'}, {'work_item_id': 'a b'}, {'evidence': {'blob': 'x' * 5000}},
])
def test_a_score_refuses_values_out_of_range(client, bad):
    _activate(definition())
    body = {'factory_id': FACTORY, 'version_hash': hash_of(definition()), 'scorer_id': 'qa', 'run_id': 'ok-1', 'passed': True, **bad}
    import json as _json
    resp = client.post('/factory/improvements/score', content=_json.dumps(body, allow_nan=True), headers={**_scorer(), 'content-type': 'application/json'})
    assert resp.status_code == 422, (bad, resp.text)


def test_measuring_a_trial_that_was_already_aborted_is_refused(client):
    proposal = _canary(client)

    async def abort():
        async with SessionLocal() as db:
            await versions.abort(db, FACTORY, 'local-user')
    anyio.run(abort)
    resp = client.post(f"/factory/improvements/{proposal['id']}/measure", headers=HUMAN)
    assert resp.status_code == 409 and resp.json()['detail']['code'] == 'not_canary'


def test_promoting_needs_the_trial_still_running_and_promotes_it(client):
    proposal = _canary(client)
    for index in range(20):
        assert _score(client, proposal['before_hash'], f'base-{index}', False).status_code == 200
        assert _score(client, proposal['after_hash'], f'trial-{index}', True).status_code == 200
    measured = client.post(f"/factory/improvements/{proposal['id']}/measure", headers=HUMAN)
    assert measured.status_code == 200 and measured.json()['verdict'] == 'improved'
    promoted = client.post(f"/factory/improvements/{proposal['id']}/promoted", headers=HUMAN)
    assert promoted.status_code == 200 and promoted.json()['status'] == 'promoted'
    assert _state().canary is None and _state().stable.hash == proposal['after_hash']


def test_promoting_an_aborted_trial_is_refused(client):
    proposal = _canary(client)
    for index in range(20):
        _score(client, proposal['before_hash'], f'base-{index}', False)
        _score(client, proposal['after_hash'], f'trial-{index}', True)
    assert client.post(f"/factory/improvements/{proposal['id']}/measure", headers=HUMAN).json()['verdict'] == 'improved'

    async def abort():
        async with SessionLocal() as db:
            await versions.abort(db, FACTORY, 'local-user')
    anyio.run(abort)
    resp = client.post(f"/factory/improvements/{proposal['id']}/promoted", headers=HUMAN)
    assert resp.status_code == 409 and resp.json()['detail']['code'] == 'not_ready'


# ------------------------------------------------------------------------------------------------------------- what a proposal holds

def test_an_after_that_is_not_a_valid_definition_never_becomes_a_trial(client):
    _activate(definition())
    broken = definition('Build.')
    del broken['agents']['builder']['permissions']
    resp = client.post('/factory/improvements/analyze', json={'factory_id': FACTORY, 'after': broken, 'justification': 'x'}, headers=HUMAN)
    assert resp.status_code == 200 and resp.json()['status'] == 'rejected'
    assert 'invalid_definition' in {reason['code'] for reason in resp.json()['reasons']}


def test_an_after_named_for_another_factory_is_refused(client):
    _activate(definition())
    _activate(definition(name=OTHER), OTHER)
    foreign = definition('Build, then ask.', name=OTHER)
    resp = client.post('/factory/improvements/analyze', json={'factory_id': FACTORY, 'after': foreign, 'justification': 'x'}, headers=HUMAN)
    assert resp.status_code == 200 and resp.json()['status'] == 'rejected'
    assert 'wrong_factory' in {reason['code'] for reason in resp.json()['reasons']}
    assert _state(OTHER).canary is None


def test_a_secret_in_the_after_is_refused_and_not_stored(client):
    _activate(definition())
    leaky = definition('Use the key sk-ant-api03-' + 'A' * 40 + ' when you call.')
    resp = client.post('/factory/improvements/analyze', json={'factory_id': FACTORY, 'after': leaky, 'justification': 'x'}, headers=HUMAN)
    assert resp.status_code == 422 and resp.json()['detail']['code'] == 'looks_secret'
    assert client.get('/factory/improvements', params={'factory_id': FACTORY}).json()['proposals'] == []


def test_a_benchmark_model_must_be_a_model_name(client):
    _activate(definition())
    resp = client.post('/factory/improvements/benchmarks/apply', json={'factory_id': FACTORY, 'agent': 'builder', 'model': 'x\ny; merge'}, headers=HUMAN)
    assert resp.status_code == 422


def test_a_trial_value_must_be_a_finite_number(client):
    import json as _json
    trials = [{'name': 'a', 'quality': float('nan'), 'cost': 1, 'seconds': 1}, {'name': 'b', 'quality': 0.5, 'cost': 1, 'seconds': 1}]
    resp = client.post('/factory/improvements/benchmarks/recommend', content=_json.dumps({'trials': trials}, allow_nan=True),
                       headers={'content-type': 'application/json'})
    assert resp.status_code == 422


def test_failure_ids_must_belong_to_the_factory(client):
    _activate(definition())
    resp = client.post('/factory/improvements/analyze', json={'factory_id': FACTORY, 'code_patch': 'Ask first.\n', 'justification': 'x',
                                                              'failure_ids': ['00000000-0000-0000-0000-000000000000']}, headers=HUMAN)
    assert resp.status_code == 422 and resp.json()['detail']['code'] == 'unknown_failure'


@pytest.mark.parametrize('patch', ['gh pr merge 12 --squash\n', 'git merge main\n', 'auto-merge: true\n', '{"action": "merge"}\n',
                                   'git -C . merge main\n', 'git --no-pager -c x=y merge main\n', 'curl -X PUT $API/pulls/$PR/merge\n',
                                   'gh pr\n  merge 3\n', 'action:\n  merge\n'])
def test_a_code_fix_that_merges_is_refused(client, patch):
    _activate(definition())
    resp = client.post('/factory/improvements/analyze', json={'factory_id': FACTORY, 'code_patch': patch, 'justification': 'x'}, headers=HUMAN)
    assert resp.status_code == 200 and resp.json()['status'] == 'rejected', patch
    assert any(reason['code'] == 'add_merge' for reason in resp.json()['reasons'])


def test_a_code_fix_with_a_secret_is_refused(client):
    _activate(definition())
    resp = client.post('/factory/improvements/analyze', json={'factory_id': FACTORY, 'code_patch': 'token = "ghp_' + 'a' * 36 + '"\n', 'justification': 'x'}, headers=HUMAN)
    assert resp.status_code == 422 and resp.json()['detail']['code'] == 'looks_secret'


def test_notes_are_held_to_the_memory_limits_and_the_same_refusals(client):
    _activate(definition())
    after = definition('Build, then ask.')
    long_note = client.post('/factory/improvements/analyze', json={'factory_id': FACTORY, 'after': after, 'justification': 'x',
                                                                   'notes': [{'agent_id': 'builder', 'text': 'x' * 401}]}, headers=HUMAN)
    assert long_note.status_code == 422
    stranger = client.post('/factory/improvements/analyze', json={'factory_id': FACTORY, 'after': after, 'justification': 'x',
                                                                  'notes': [{'agent_id': 'ghost', 'text': 'Ask first.'}]}, headers=HUMAN)
    assert stranger.status_code == 200 and 'unknown_agent' in {reason['code'] for reason in stranger.json()['reasons']}
    merging = client.post('/factory/improvements/analyze', json={'factory_id': FACTORY, 'after': after, 'justification': 'x',
                                                                 'notes': [{'agent_id': 'builder', 'text': 'When green, run gh pr merge.'}]}, headers=HUMAN)
    assert merging.status_code == 200 and 'add_merge' in {reason['code'] for reason in merging.json()['reasons']}


# ------------------------------------------------------------------------------------------------------------------ deciding late

def test_a_proposal_made_against_an_older_version_is_stale(client):
    _activate(definition())
    old = client.post('/factory/improvements/analyze', json={'factory_id': FACTORY, 'after': definition('Build, then ask.'),
                                                             'justification': 'x'}, headers=HUMAN).json()
    assert old['status'] == 'pending'
    hardened = definition()
    hardened['policy']['maxReviewReturns'] = 1
    _activate(hardened)
    resp = client.post(f"/factory/improvements/{old['id']}/decide", json={'action': 'approve'}, headers=HUMAN)
    assert resp.status_code == 409 and resp.json()['detail']['code'] == 'stale'
    assert _state().canary is None and _state().stable.hash == hash_of(hardened)
    listed = {row['id']: row for row in client.get('/factory/improvements', params={'factory_id': FACTORY}).json()['proposals']}
    assert listed[old['id']]['status'] == 'stale'


# ---------------------------------------------------------------------------------------------------------------------- the trail

def test_the_trail_rows_cannot_be_changed_or_deleted(client):
    proposal = _canary(client)
    assert _score(client, proposal['after_hash'], 'kept', False).status_code == 200

    async def tamper(model, change):
        async with SessionLocal() as db:
            row = (await db.scalars(select(model).limit(1))).first()
            assert row is not None
            change(db, row)
            try:
                await db.commit()
            except AppendOnlyError:
                await db.rollback()
                return 'refused'
            return 'changed'

    for model, field, value in ((ImprovementEvent, 'type', 'approved'), (FactoryScore, 'passed', True), (FactoryFailure, 'reason', 'none')):
        updated = anyio.run(tamper, model, lambda db, row, f=field, v=value: setattr(row, f, v))
        deleted = anyio.run(tamper, model, lambda db, row: db.sync_session.delete(row))
        assert (updated, deleted) == ('refused', 'refused'), model


def test_the_export_is_paginated(client):
    proposal = _canary(client)
    first = client.get('/factory/improvements/export', params={'factory_id': FACTORY, 'limit': 1}).json()
    assert len(first['events']) == 1 and first['next'] is not None
    rest = client.get('/factory/improvements/export', params={'factory_id': FACTORY, 'after_id': first['next']}).json()
    assert [event['type'] for event in first['events'] + rest['events']] == ['proposed', 'approved', 'canary_started']
    assert rest['next'] is None
    assert client.get('/factory/improvements/export', params={'limit': 5000}).status_code == 422
    assert proposal['id']


# ---------------------------------------------------------------------------------------------------------- the trial measures itself

def test_a_worse_trial_rolls_back_from_the_scores_alone(client):
    proposal = _canary(client)
    for index in range(20):
        assert _score(client, proposal['before_hash'], f'base-{index}', True).status_code == 200
    for index in range(20):
        assert _score(client, proposal['after_hash'], f'trial-{index}', False).status_code == 200
    assert _state().canary is None and _state().stable.hash == proposal['before_hash']
    listed = {row['id']: row for row in client.get('/factory/improvements', params={'factory_id': FACTORY}).json()['proposals']}
    assert listed[proposal['id']]['status'] == 'rolled_back' and listed[proposal['id']]['verdict'] == 'worsened'
    events = client.get('/factory/improvements/export', params={'factory_id': FACTORY}).json()['events']
    measured = [event for event in events if event['type'] == 'measured']
    assert len(measured) == 1 and measured[0]['actor']['kind'] == 'system'


def test_an_improved_trial_waits_for_a_person_to_promote(client):
    proposal = _canary(client)
    for index in range(20):
        _score(client, proposal['before_hash'], f'base-{index}', False)
        _score(client, proposal['after_hash'], f'trial-{index}', True)
    assert _state().canary is not None and _state().canary.hash == proposal['after_hash']
    listed = {row['id']: row for row in client.get('/factory/improvements', params={'factory_id': FACTORY}).json()['proposals']}
    assert listed[proposal['id']]['status'] == 'canary' and listed[proposal['id']]['verdict'] == 'improved'
    events = client.get('/factory/improvements/export', params={'factory_id': FACTORY}).json()['events']
    assert [event['type'] for event in events].count('measured') == 1  # the same verdict is written once, not on every score


def test_the_service_itself_refuses_a_decision_without_the_person(client):
    _activate(definition())
    proposal = client.post('/factory/improvements/analyze', json={'factory_id': FACTORY, 'after': definition('Build, then ask.'),
                                                                  'justification': 'x'}, headers=HUMAN).json()
    from factory.improvement import service
    from factory.service import FactoryError

    async def go():
        async with SessionLocal() as db:
            for call in (lambda: service.decide(db, proposal['id'], 'approve', ('agent', None)),
                         lambda: service.measure(db, proposal['id'], ('agent', None)),
                         lambda: service.revert(db, proposal['id'], ('agent', None)),
                         lambda: service.mark_promoted(db, proposal['id'], ('agent', None))):
                with pytest.raises(FactoryError) as caught:
                    await call()
                assert caught.value.code == 'human_only'
    anyio.run(go)
