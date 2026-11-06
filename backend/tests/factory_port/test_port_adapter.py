"""The adapter that gives the intake package (B) its FactoryPort over the Forja service (ADR 0053, 0059; issue #332)."""
from __future__ import annotations

import asyncio
import json

import anyio
import pytest
from sqlalchemy import delete, select

from database import SessionLocal, init_db
from factory import port_adapter, service
from factory.orm import WorkItem, WorkItemArtifact, WorkItemEvent, WorkItemRun
from factory_intake.pipeline import deliver
from factory_intake.port import Claim, FactoryError, FactoryPort, ReleaseResult, SourceRef, WorkItemDraft


async def _reset():
    await init_db()
    async with SessionLocal() as db:
        for table in (WorkItemEvent, WorkItemRun, WorkItemArtifact, WorkItem):
            await db.execute(delete(table))
        await db.commit()


@pytest.fixture()
def port():
    anyio.run(_reset)
    built = port_adapter.build_port('payments')
    yield built
    built.close()
    anyio.run(_reset)


def draft(key='k1', ref='1', kind='github', title='Fix login', **extra):
    return WorkItemDraft(source=SourceRef(kind=kind, ref=ref), title=title, idempotency_key=key, **extra)


def read(fn):
    async def go():
        async with SessionLocal() as db:
            return await fn(db)
    return anyio.run(go)


def test_the_adapter_satisfies_the_port(port):
    assert isinstance(port, FactoryPort)
    assert isinstance(port_adapter.build_port(), FactoryPort)  # with no id: the default Forja


def test_submit_creates_replays_and_follows_up(port):
    first = port.submit(draft(body='It breaks.', labels=('bug',), requested_by='alice'))
    assert first.created and first.item.state == 'queued' and first.item.stage == 'intake' and first.item.source.ref == '1'
    replay = port.submit(draft(title='other'))
    assert replay.replay and replay.item.id == first.item.id
    follow = port.submit(draft('k2'))
    assert not follow.created and not follow.replay and follow.item.id == first.item.id


def test_a_closed_item_does_not_swallow_a_new_request_for_the_same_ref(port):
    first = port.submit(draft()).item
    port.cancel(first.id)
    second = port.submit(draft('k2'))
    assert second.created and second.item.id != first.id


def test_the_pipeline_comments_on_a_reply_in_the_thread(port):
    created = deliver(port, draft('i:item', body='first', requested_by='alice'))
    reply = deliver(port, draft('i:comment:2', body='@forja more', requested_by='bob', is_reply=True))
    assert created.outcome == 'created' and reply.outcome == 'followup'

    async def notes(db):
        rows = await db.scalars(select(WorkItemEvent).where(WorkItemEvent.work_item_id == created.item.id, WorkItemEvent.type == 'note'))
        return [(e.actor_kind, e.actor_id, json.loads(e.data_json)['text']) for e in rows]
    assert read(notes) == [('source', 'bob', '@forja more')]  # the note is the source's, not a person's decision


def test_trusted_instructions_and_the_ceiling_stay_apart_from_the_origin_text(port):
    item = port.submit(draft(body='untrusted body', instructions='Owner: be careful.', token_ceiling=5000, agent='builder', automation='nightly')).item

    async def row(db):
        found = await db.get(WorkItem, item.id)
        return found.origin_text, found.instructions, found.token_ceiling, found.agent, found.automation
    text, instructions, ceiling, agent, automation = read(row)
    assert text == 'untrusted body' and 'Owner' not in text
    assert (instructions, ceiling, agent, automation) == ('Owner: be careful.', 5000, 'builder', 'nightly')


def test_get_and_list(port):
    a = port.submit(draft('a', ref='a', title='A')).item
    b = port.submit(draft('b', ref='b', title='B', kind='cli')).item
    assert port.get(a.id).title == 'A'
    with pytest.raises(FactoryError) as raised:
        port.get('nope')
    assert raised.value.code == 'not_found'
    assert [i.id for i in port.list()] == [b.id, a.id]  # newest first
    assert [i.id for i in port.list(source='cli')] == [b.id]
    assert [i.id for i in port.list(state='queued', limit=1)] == [b.id]
    port.cancel(a.id)
    assert [i.id for i in port.list(state='cancelled')] == [a.id]


def test_claim_records_the_worktree_and_release_never_completes(port):
    item = port.submit(draft()).item
    claimed = port.claim(item.id, 'cli/alice', 'wt-1')
    assert claimed.state == 'claimed' and claimed.claim == Claim(holder='cli/alice', worktree_ref='wt-1')

    async def to_implement(db):
        row = await service.get(db, item.id)
        row.stage = 'implement'
        await db.commit()
    read(to_implement)
    released = port.release(item.id, ReleaseResult(summary='done locally', branch='forja/x', status='needs_review'))
    assert released.state == 'queued' and released.stage == 'review' and released.claim is None  # back to review, never to done


def test_release_abandoned_restores_the_status_it_had_and_keeps_a_human_checkpoint(port):
    item = port.submit(draft()).item

    async def ask(db):
        row = await service.get(db, item.id)
        await service.request_checkpoint(db, row, ('foreman', 'foreman'), 'question', 'Which env?')
        await db.commit()
    read(ask)
    assert port.get(item.id).state == 'awaiting_human'
    port.claim(item.id, 'cli/alice')
    back = port.release(item.id, ReleaseResult(summary='gave up', status='abandoned'))
    assert back.state == 'awaiting_human'  # the question is still waiting for a person


def test_service_errors_become_port_errors_with_stable_codes(port):
    item = port.submit(draft()).item
    port.cancel(item.id)
    with pytest.raises(FactoryError) as raised:
        port.claim(item.id, 'someone')
    assert raised.value.code == 'cannot_claim'  # a closed item is not claimable
    with pytest.raises(FactoryError) as invalid:
        port.submit(draft('k9', ref='9', agent='Not A Valid Agent Id'))
    assert invalid.value.code == 'invalid_draft'


def test_it_works_from_inside_a_running_event_loop(port):
    item = port.submit(draft()).item

    async def inside():
        return port.get(item.id).id  # the port is synchronous; a caller may well be async
    assert asyncio.run(inside()) == item.id


def test_metrics_reuse_the_forja_figures(port):
    port.submit(draft())
    figures = port.metrics(7)
    assert figures['schemaVersion'] == 1 and 'throughput' in figures


def test_the_intake_loader_finds_the_adapter_without_configuration(monkeypatch):
    from factory_intake.loader import load_port
    monkeypatch.delenv('OH_FACTORY_PORT', raising=False)
    anyio.run(_reset)
    found = load_port()
    try:
        assert isinstance(found, port_adapter.ForjaPort)
    finally:
        found.close()


def test_the_cli_submits_through_the_adapter(monkeypatch, capsys):
    from oharness.cli import main
    monkeypatch.delenv('OH_FACTORY_PORT', raising=False)
    anyio.run(_reset)
    code = main(['forja', 'submit', 'Fix the login page', '--note', 'It breaks on Safari.', '--ref', 'cli-1', '--json'])
    out = json.loads(capsys.readouterr().out)
    anyio.run(_reset)
    assert code == 0 and out['outcome'] == 'created' and out['item']['title'] == 'Fix the login page' and out['item']['state'] == 'queued'


# ---- review round

def test_a_bare_database_works_before_the_app_ever_ran(tmp_path):
    url = f"sqlite+aiosqlite:///{(tmp_path / 'fresh.db').as_posix()}"
    fresh = port_adapter.ForjaPort('payments', url)
    try:
        assert fresh.submit(draft()).created  # versions, items, events: every table the service reads exists
    finally:
        fresh.close()


def test_oversized_arguments_are_port_errors_not_validation_errors(port):
    item = port.submit(draft()).item
    with pytest.raises(FactoryError) as too_long:
        port.claim(item.id, 'h' * 500)
    assert too_long.value.code == 'invalid_argument'
    port.claim(item.id, 'cli/alice')
    with pytest.raises(FactoryError) as summary:
        port.release(item.id, ReleaseResult(summary='s' * 9000, status='abandoned'))
    assert summary.value.code == 'invalid_argument'


def test_a_closed_port_says_so(port):
    item = port.submit(draft()).item
    port.close()
    with pytest.raises(FactoryError) as raised:
        port.get(item.id)
    assert raised.value.code == 'closed'
    port.close()  # twice is fine


def test_a_forja_cannot_touch_the_items_of_another(port):
    other = port_adapter.build_port('billing')
    try:
        item = port.submit(draft()).item
        for call in (lambda: other.get(item.id), lambda: other.cancel(item.id), lambda: other.claim(item.id, 'x'),
                     lambda: other.comment(item.id, 'hi', 'bob')):
            with pytest.raises(FactoryError) as raised:
                call()
            assert raised.value.code == 'not_found'
        assert port.get(item.id).state == 'queued'
    finally:
        other.close()


def test_only_claimable_items_can_be_claimed(port):
    item = port.submit(draft()).item

    async def to_waiting(db):
        row = await service.get(db, item.id)
        row.status, row.stage = 'waiting_merge', 'handoff'
        await db.commit()
    read(to_waiting)
    with pytest.raises(FactoryError) as raised:
        port.claim(item.id, 'cli/alice')
    assert raised.value.code == 'cannot_claim'


def test_a_busy_database_is_a_port_error_without_sql(port, monkeypatch):
    from sqlalchemy.exc import OperationalError

    async def locked(*args, **kwargs):
        raise OperationalError('INSERT INTO factory_work_items VALUES (?)', {}, Exception('database is locked'))
    monkeypatch.setattr(service, 'create', locked)
    with pytest.raises(FactoryError) as raised:
        port.submit(draft('busy', ref='busy'))
    assert raised.value.code == 'unavailable' and 'INSERT' not in str(raised.value)


# ---- review round 2

GHP = 'ghp_' + 'A1b2C3d4' * 4 + 'A1b2'


def test_secrets_in_ids_titles_and_comments_are_redacted_before_they_are_cut_or_stored(port):
    item = port.submit(draft(title='x' * 195 + GHP, requested_by=f'user-{GHP}')).item
    assert 'ghp_' not in item.title

    async def events(db):
        rows = await db.scalars(select(WorkItemEvent).where(WorkItemEvent.work_item_id == item.id))
        return json.dumps([(e.actor_id, e.data_json) for e in rows])
    port.comment(item.id, 'y' * 19_990 + GHP, f'author-{GHP}')
    stored = read(events)
    assert 'ghp_' not in stored and 'A1b2C3d4' not in stored


def test_an_inaccessible_database_is_a_stable_error_and_the_loader_explains_it(tmp_path, monkeypatch):
    missing = f"sqlite+aiosqlite:///{(tmp_path / 'no' / 'such' / 'dir' / 'x.db').as_posix()}"
    with pytest.raises(FactoryError) as raised:
        port_adapter.ForjaPort('payments', missing)
    assert raised.value.code == 'unavailable' and 'sqlalchemy' not in str(raised.value).lower() and str(tmp_path) not in str(raised.value)
    from factory_intake.loader import FoundationMissing, load_port
    monkeypatch.setattr(port_adapter, 'DATABASE_URL', missing)
    monkeypatch.setattr(port_adapter.ForjaPort.__init__, '__defaults__', (missing,))
    with pytest.raises(FoundationMissing):
        load_port('factory.port_adapter:build_port')


def test_a_bad_forja_id_is_said_clearly(monkeypatch):
    monkeypatch.setenv('OH_FORJA_ID', 'Not A Valid Id!')
    with pytest.raises(FactoryError) as raised:
        port_adapter.build_port()
    assert raised.value.code == 'invalid_forja_id' and 'OH_FORJA_ID' in str(raised.value)
    with pytest.raises(FactoryError):
        port_adapter.build_port('UPPER')
