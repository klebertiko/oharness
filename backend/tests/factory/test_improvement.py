"""Proposal, human decision, trial, measurement and rollback. A worse trial undoes itself."""
from __future__ import annotations

import anyio
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, text

from database import SessionLocal
from factory.improvement.orm import guard_statements, unguard_statements
from factory import auth, versions
from factory.definition import hash_of
from factory.improvement.orm import FactoryFailure, FactoryScore, ImprovementEvent, ImprovementProposal
from main import app

from forja_improvement_defs import FACTORY, HUMAN, definition as _definition

SCORER = {auth.SCORER_HEADER: auth.scorer_credential()}


async def _reset():
    async with SessionLocal() as db:
        for statement in unguard_statements():  # the trail is append-only; a test reset lifts the triggers, then puts them back
            await db.execute(text(statement))
        await db.execute(delete(ImprovementEvent))
        await db.execute(delete(ImprovementProposal))
        await db.execute(delete(FactoryScore))
        await db.execute(delete(FactoryFailure))
        await db.execute(delete(versions.DefinitionVersion).where(versions.DefinitionVersion.factory_id == FACTORY))
        for statement in guard_statements():
            await db.execute(text(statement))
        await db.commit()


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    with TestClient(app) as test_client:
        anyio.run(_reset)
        yield test_client
    anyio.run(_reset)


def _activate(definition: dict):
    async def go():
        async with SessionLocal() as db:
            await versions.activate(db, definition, hash_of(definition), 'local-user')
    anyio.run(go)


def _state():
    async def go():
        async with SessionLocal() as db:
            return await versions.state(db, FACTORY)
    return anyio.run(go)


def test_forbidden_proposals_are_rejected_with_a_reason_and_an_event(client):
    _activate(_definition())
    cases = {
        'weaken_gate': {**_definition('Build.'), 'stages': {'review': {'enabled': False, 'required': False}, 'verify': {'enabled': True, 'required': True}, 'spec': {'enabled': True, 'required': True}}},
        'raise_permission': {**_definition('Build.'), 'policy': {**_definition()['policy'], 'maxPermissionMode': 'full'}},
        'add_merge': {**_definition('Build.'), 'merge': True},
        'lower_threshold': {**_definition('Build.'), 'scorers': {'qa': {'kind': 'deterministic', 'enabled': True, 'passingScore': 0.1, 'selfImprovement': True, 'check': 'qa_rejected'}}},
    }
    # The spread above keeps the same instructions when the case also spreads _definition('Build.'), so force a real edit
    # only where the case itself does not already differ. Each case changes a protected field, which is enough.
    for code, after in cases.items():
        resp = client.post('/factory/improvements/analyze', json={'factory_id': FACTORY, 'after': after, 'justification': code}, headers=HUMAN)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body['status'] == 'rejected'
        assert code in {reason['code'] for reason in body['reasons']}
    exported = client.get('/factory/improvements/export', params={'factory_id': FACTORY}).json()['events']
    assert [event['type'] for event in exported] == ['rejected_by_validator'] * 4
    pending = [row for row in client.get('/factory/improvements', params={'factory_id': FACTORY}).json()['proposals'] if row['status'] == 'pending']
    assert pending == []


def test_a_worse_trial_rolls_itself_back_and_every_decision_is_exportable(client):
    before = _definition()
    _activate(before)
    after = _definition('Build the change, and ask a person when a check already failed.')
    created = client.post('/factory/improvements/analyze', json={'factory_id': FACTORY, 'after': after, 'justification': 'Ask sooner.'}, headers=HUMAN)
    assert created.status_code == 200, created.text
    proposal = created.json()
    assert proposal['status'] == 'pending'
    refused = client.post(f"/factory/improvements/{proposal['id']}/decide", json={'action': 'approve'})
    assert refused.status_code == 403 and refused.json()['detail']['code'] == 'human_only'
    approved = client.post(f"/factory/improvements/{proposal['id']}/decide", json={'action': 'approve'}, headers=HUMAN)
    assert approved.status_code == 200, approved.text
    assert approved.json()['status'] == 'canary'
    assert _state().canary is not None and _state().canary.hash == proposal['after_hash']
    for index in range(20):
        base = client.post('/factory/improvements/score', headers=SCORER, json={'factory_id': FACTORY, 'version_hash': proposal['before_hash'], 'scorer_id': 'qa', 'run_id': f'base-{index}', 'passed': True})
        assert base.status_code == 200, base.text
    for index in range(20):
        trial = client.post('/factory/improvements/score', headers=SCORER, json={
            'factory_id': FACTORY, 'version_hash': proposal['after_hash'], 'scorer_id': 'qa', 'run_id': f'trial-{index}',
            'passed': index < 5, 'evidence': {'qa': 'rejected' if index >= 5 else 'ok'},
        })
        assert trial.status_code == 200, trial.text
    # The scores alone measured the trial and rolled it back; asking again finds no running trial.
    late = client.post(f"/factory/improvements/{proposal['id']}/measure", headers=HUMAN)
    assert late.status_code == 409 and late.json()['detail']['code'] == 'not_canary'
    assert _state().canary is None and _state().stable.hash == proposal['before_hash']
    first = client.get('/factory/improvements/export', params={'factory_id': FACTORY}).json()['events']
    again = client.get('/factory/improvements/export', params={'factory_id': FACTORY}).json()['events']
    assert [event['id'] for event in first] == [event['id'] for event in again]
    assert [event['type'] for event in first] == ['proposed', 'approved', 'canary_started', 'measured', 'rolled_back']
    inbox = client.get('/factory/inbox').json()['entries']
    assert any(entry['type'] == 'improvement' and entry.get('notice') == 'reverted' for entry in inbox)


def test_scoring_again_reads_the_latest_attempt_and_keeps_the_first(client):
    _activate(_definition())
    version = hash_of(_definition())
    body = {'factory_id': FACTORY, 'version_hash': version, 'scorer_id': 'tests', 'run_id': 'run-1', 'agent_id': 'builder'}
    first = client.post('/factory/improvements/score', headers=SCORER, json={**body, 'label': 'tests-skipped'})
    assert first.status_code == 200 and first.json()['passed'] is False
    second = client.post('/factory/improvements/score', headers=SCORER, json={**body, 'label': 'tests-run'})
    assert second.status_code == 200 and second.json()['passed'] is True and second.json()['id'] != first.json()['id']
    listed = client.get('/factory/improvements', params={'factory_id': FACTORY}).json()
    assert [row['superseded'] for row in listed['failures']] == [True]


def test_run_now_starts_from_one_failure_and_the_schedule_waits_for_twenty_five(client):
    _activate(_definition())
    version = hash_of(_definition())
    score = {'factory_id': FACTORY, 'version_hash': version, 'scorer_id': 'qa', 'passed': False, 'agent_id': 'builder'}
    assert client.post('/factory/improvements/score', headers=SCORER, json={**score, 'run_id': 'only'}).status_code == 200
    waiting = client.post('/factory/improvements/run', json={'factory_id': FACTORY}, headers=HUMAN)
    assert waiting.status_code == 200 and waiting.json()['started'] is False and waiting.json()['open'] == 1
    forced = client.post('/factory/improvements/run', json={'factory_id': FACTORY, 'force': True}, headers=HUMAN)
    assert forced.status_code == 200 and forced.json()['started'] is True
    assert forced.json()['proposal']['failure_ids']
    for index in range(24):
        assert client.post('/factory/improvements/score', headers=SCORER, json={**score, 'run_id': f'more-{index}'}).status_code == 200
    # The forced proposal already linked the first failure, so 24 new ones are still under the line.
    still = client.post('/factory/improvements/run', json={'factory_id': FACTORY}, headers=HUMAN)
    assert still.json()['started'] is False and still.json()['open'] == 24
    assert client.post('/factory/improvements/score', headers=SCORER, json={**score, 'run_id': 'more-24'}).status_code == 200
    started = client.post('/factory/improvements/run', json={'factory_id': FACTORY}, headers=HUMAN)
    assert started.json()['started'] is True and len(started.json()['proposal']['failure_ids']) == 25


def test_a_code_fix_is_approved_by_a_person_and_does_not_start_a_trial(client):
    _activate(_definition())
    version = hash_of(_definition())
    failed = client.post('/factory/improvements/score', headers=SCORER, json={'factory_id': FACTORY, 'version_hash': version, 'scorer_id': 'qa', 'run_id': 'code-1', 'passed': False, 'agent_id': 'builder'})
    assert failed.status_code == 200
    failure_id = client.get('/factory/improvements', params={'factory_id': FACTORY}).json()['failures'][0]['id']
    proposal = client.post('/factory/improvements/analyze', json={
        'factory_id': FACTORY, 'code_patch': 'Ask before repeating a failed check.\n', 'justification': 'Fix the app.',
        'failure_ids': [failure_id],
    }, headers=HUMAN)
    assert proposal.status_code == 200, proposal.text
    body = proposal.json()
    assert body['status'] == 'pending' and body['target'] == 'code' and failure_id in body['failure_ids']
    approved = client.post(f"/factory/improvements/{body['id']}/decide", json={'action': 'approve'}, headers=HUMAN)
    assert approved.status_code == 200 and approved.json()['status'] == 'approved'
    assert _state().canary is None
    merged = client.post('/factory/improvements/analyze', json={'factory_id': FACTORY, 'code_patch': 'action: merge\n', 'justification': 'no'}, headers=HUMAN)
    assert merged.json()['status'] == 'rejected' and any(reason['code'] == 'add_merge' for reason in merged.json()['reasons'])


def test_applying_a_benchmark_result_is_a_proposal_a_person_approves(client):
    _activate(_definition())
    advice = client.post('/factory/improvements/benchmarks/recommend', json={'trials': [
        {'name': 'deep', 'quality': 0.95, 'cost': 100, 'seconds': 100},
        {'name': 'fast', 'quality': 0.80, 'cost': 30, 'seconds': 10},
        {'name': 'tiny', 'quality': 0.50, 'cost': 5, 'seconds': 50},
    ]})
    assert advice.json() == {'overall': 'deep', 'efficient': 'fast', 'cheapest': 'tiny'}
    proposal = client.post('/factory/improvements/benchmarks/apply', json={'factory_id': FACTORY, 'agent': 'builder', 'model': 'openai/gpt-4o-mini'}, headers=HUMAN)
    assert proposal.status_code == 200 and proposal.json()['status'] == 'pending' and proposal.json()['target'] == 'definition'
    approved = client.post(f"/factory/improvements/{proposal.json()['id']}/decide", json={'action': 'approve'}, headers=HUMAN)
    assert approved.status_code == 200 and approved.json()['status'] == 'canary'
    assert _state().canary is not None


def test_a_short_trial_is_not_rolled_back(client):
    _activate(_definition())
    after = _definition('Build, then pause.')
    proposal = client.post('/factory/improvements/analyze', json={'factory_id': FACTORY, 'after': after, 'justification': 'Pause.'}, headers=HUMAN).json()
    client.post(f"/factory/improvements/{proposal['id']}/decide", json={'action': 'approve'}, headers=HUMAN)
    client.post('/factory/improvements/score', headers=SCORER, json={'factory_id': FACTORY, 'version_hash': proposal['after_hash'], 'scorer_id': 'qa', 'run_id': 'one', 'passed': False})
    measured = client.post(f"/factory/improvements/{proposal['id']}/measure", headers=HUMAN)
    assert measured.json()['verdict'] is None and measured.json()['reason'] == 'sample'
    assert _state().canary is not None
