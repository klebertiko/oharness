"""Metrics of the Forja (ADR 0058): computed from the work items and their events, never stored, separable by definition version."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import anyio
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from database import SessionLocal
from factory.orm import WorkItem, WorkItemArtifact, WorkItemEvent, WorkItemRun
from main import app

NOW = datetime.now(timezone.utc).replace(tzinfo=None)


async def _reset():
    async with SessionLocal() as db:
        for table in (WorkItemEvent, WorkItemRun, WorkItemArtifact, WorkItem):
            await db.execute(delete(table))
        await db.commit()


@pytest.fixture()
def client():
    with TestClient(app) as c:
        anyio.run(_reset)
        yield c
    anyio.run(_reset)


def build(ref, born, events, *, version='v1', factory='payments', cost=0, status='waiting_merge', artifacts=(), runs=()):
    """events: [(minutes after birth, type, actor_kind, data)]; artifacts: [(minutes after birth, ref, label)]."""
    async def go():
        async with SessionLocal() as db:
            item = WorkItem(factory_id=factory, factory_version=version, title=ref, source_kind='manual', source_ref=ref, created_at=born, updated_at=born,
                            cost_tokens=cost, status=status, stage='handoff')
            db.add(item)
            await db.flush()
            for number, (minutes, type_, actor, data) in enumerate(events, 1):
                db.add(WorkItemEvent(work_item_id=item.id, sequence=number, type=type_, actor_kind=actor, data_json=json.dumps(data), at=born + timedelta(minutes=minutes)))
            for minutes, branch, label in artifacts:
                db.add(WorkItemArtifact(work_item_id=item.id, kind='diff', ref=branch, label=label, created_at=born + timedelta(minutes=minutes)))
            for stage in runs:
                db.add(WorkItemRun(work_item_id=item.id, run_id=f'{ref}-{stage}', stage=stage))
            await db.commit()
    anyio.run(go)


def art(minutes, branch):
    return (minutes, 'artifact_added', 'agent', {'kind': 'diff', 'ref': branch})


def seed():
    day = timedelta(days=1)
    build('A', NOW - 5 * day, [
        (60, 'run_linked', 'foreman', {}), (180, *art(0, 'forja/a')[1:]), (240, 'review_verdict', 'foreman', {'verdict': 'approved'}),
        (1440, 'merge_observed', 'system', {}), (1441, 'completed', 'system', {})], cost=1000, status='done', artifacts=[(180, 'forja/a', '')], runs=['implement', 'review'])
    build('B', NOW - 4 * day, [
        (60, 'run_linked', 'foreman', {}), (120, *art(0, 'forja/b1')[1:]), (180, 'review_verdict', 'foreman', {'verdict': 'changes_requested'}),
        (181, 'returned_to_implement', 'foreman', {}), (360, *art(0, 'forja/b2')[1:]), (420, 'review_verdict', 'foreman', {'verdict': 'approved'}),
        (500, 'note', 'human', {}), (501, 'checkpoint_resolved', 'human', {'kind': 'question'}), (502, 'spec_approved', 'human', {})],
        cost=3000, artifacts=[(120, 'forja/b1', ''), (360, 'forja/b2', '')], runs=['implement'])
    build('C', NOW - 3 * day, [(10, 'run_linked', 'foreman', {}), (40, *art(0, 'forja/c')[1:]), (50, 'verify_failed', 'foreman', {})],
          version='v2', cost=500, status='failed', artifacts=[(40, 'forja/c', 'lines=700')])
    build('OLD', NOW - 100 * day, [(60, 'run_linked', 'foreman', {}), (120, *art(0, 'forja/old')[1:]), (200, 'merge_observed', 'system', {}), (201, 'completed', 'system', {})],
          cost=9000, status='done', artifacts=[(120, 'forja/old', '')])


def metrics(client, **params):
    resp = client.get('/factory/metrics', params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_the_numbers_follow_the_events_in_the_window(client):
    seed()
    m = metrics(client, window='30d')
    assert m['schemaVersion'] == 1 and m['window'] == '30d'
    assert m['throughput'] == {'prs_opened': 4, 'prs_merged': 1, 'items_opened': 3, 'items_merged': 1, 'items_completed': 1}
    assert m['cost']['median_tokens_per_pr'] == 1250 and m['cost']['total_tokens'] == 4500  # 1000, 1500, 1500, 500
    assert m['quality'] == {'items_reviewed': 2, 'approved_first_review': 0.5, 'avg_returns_to_implement': 0.5, 'verify_failures': 1}
    assert m['cycle_time']['run_to_pr_median_s'] == 3600 and m['cycle_time']['run_to_first_review_median_s'] == 9000
    assert m['cycle_time']['run_to_merge_median_s'] == 1380 * 60


def test_the_window_decides_what_counts(client):
    seed()
    assert metrics(client, window='7d')['throughput']['prs_opened'] == 4
    wide = metrics(client, window='90d')
    assert wide['throughput']['prs_opened'] == 4  # the old item is 100 days away: still out
    start = (NOW - timedelta(days=110)).date().isoformat()
    ranged = metrics(client, since=start, until=(NOW - timedelta(days=95)).date().isoformat())
    assert ranged['throughput']['prs_opened'] == 1 and ranged['throughput']['prs_merged'] == 1 and ranged['window'] == 'custom'


def test_the_figures_split_by_definition_version(client):
    seed()
    by_version = metrics(client, window='30d')['by_version']
    assert by_version['v1']['throughput']['items_opened'] == 2 and by_version['v2']['throughput']['items_opened'] == 1
    only = metrics(client, window='30d', factory_version='v2')
    assert only['throughput']['prs_opened'] == 1 and only['quality']['verify_failures'] == 1


def test_a_factory_filter_and_empty_data_are_honest_zeros(client):
    seed()
    other = metrics(client, window='30d', factory_id='billing')
    assert other['throughput']['prs_opened'] == 0 and other['cost']['median_tokens_per_pr'] is None and other['cycle_time']['run_to_pr_median_s'] is None
    assert other['quality']['approved_first_review'] is None


def test_what_the_data_cannot_say_is_reported_as_unavailable_not_invented(client):
    seed()
    m = metrics(client, window='30d')
    assert m['autonomy']['merged_without_human_push'] == {'available': False, 'reason': 'needs the commit authors of the branch, which the Forja does not keep'}
    assert m['cost']['tokens_by_stage']['available'] is False and m['cost']['tokens_by_stage']['runs'] == {'implement': 2, 'review': 1}
    assert m['cost']['by_size']['unknown']['prs'] == 3 and m['cost']['by_size']['L']['prs'] == 1  # 700 changed lines is L


def test_human_interventions_do_not_count_the_decisions_a_person_is_meant_to_take(client):
    seed()
    # B has a note and an answer (2 interventions); approving the spec is the expected checkpoint and is not one
    m = metrics(client, window='30d')
    assert m['autonomy']['human_interventions_per_item'] == pytest.approx(2 / 3)


def test_bad_windows_are_refused(client):
    assert client.get('/factory/metrics', params={'window': '1y'}).status_code == 422
    assert client.get('/factory/metrics', params={'since': 'yesterday'}).status_code == 422
    assert client.get('/factory/metrics', params={'since': '2026-02-01', 'until': '2026-01-01'}).status_code == 422
    assert client.get('/factory/metrics', params={'since': '1990-01-01', 'until': '2026-01-01'}).status_code == 422  # too wide a range


def test_metrics_carry_no_personal_data(client):
    seed()
    text = json.dumps(metrics(client, window='30d'))
    assert 'forja/a' not in text and 'Item' not in text and 'payments' not in text  # counts and durations only
