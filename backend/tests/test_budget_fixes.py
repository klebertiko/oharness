import anyio
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete
from database import Base, engine, SessionLocal
from models import BudgetConfig, UsageRecord
from routers.usage import router
import usage_tracking as ut

@pytest.fixture(autouse=True)
def clean():
    async def reset():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with SessionLocal() as db:
            await db.execute(delete(UsageRecord))
            await db.execute(delete(BudgetConfig))
            await db.commit()
    anyio.run(reset)
    yield
    anyio.run(reset)

@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        yield client

@pytest.mark.parametrize('raw', ['NaN', 'Infinity', '-Infinity', '1e400'])
def test_nonfinite_budget_preserves_valid_limit(client, raw):
    assert client.put('/usage/budget', json={'limitUsd': 5}).status_code == 200
    response = client.put('/usage/budget', content='{"limitUsd":' + raw + '}', headers={'Content-Type': 'application/json'})
    assert response.status_code == 400
    assert client.get('/usage/budget').json()['limitUsd'] == 5
    assert client.get('/usage/summary').status_code == 200

def test_legacy_infinite_budget_reads_safely_and_blocks(client):
    async def seed():
        async with SessionLocal() as db:
            db.add(BudgetConfig(id='global', limit_usd=float('inf')))
            await db.commit()
    anyio.run(seed)
    body = client.get('/usage/budget').json()
    assert body['state'] == 'invalid'
    assert body['limitUsd'] is None
    assert client.get('/usage/summary').status_code == 200
    async def check():
        async with SessionLocal() as db:
            with pytest.raises(ut.BudgetExceededError):
                await ut.enforce_budget_or_raise(db)
    anyio.run(check)
    assert client.put('/usage/budget', json={'limitUsd': 5}).json()['state'] == 'ok'

def test_single_token_cost_retains_precision():
    cost, price = ut.compute_cost(1, 'claude-haiku-4-5')
    assert price == pytest.approx(2.4)
    assert cost == pytest.approx(0.0000024, abs=1e-15)

def test_unknown_cost_is_not_free():
    assert ut.compute_cost(100, 'unknown-api-model') == (None, None)

def usage_kwargs(**overrides):
    return dict(run_id='run', node_id=None, source='triage', connection_id='conn',
                provider='openrouter', adapter='openai-compatible', model='claude-sonnet-5',
                tokens_total=100, **overrides)

@pytest.mark.parametrize('residence,billing,price,cost', [
    ('local', 'none', 0.0, 0.0),
    # I11: a seat's cost is unknown — never 0.0, never the API list price.
    ('cloud', 'subscription', None, None),
])
def test_billing_record_distinguishes_local_and_subscription(residence, billing, price, cost):
    async def go():
        async with SessionLocal() as db:
            row = await ut.record_usage(db, **usage_kwargs(residence=residence, billing=billing))
            assert row.price_per_mtok == price
            assert row.cost_usd == cost
            assert row.billing == billing
    anyio.run(go)

@pytest.mark.parametrize('residence,billing', [('cloud', 'subscription'), ('local', 'subscription')])
@pytest.mark.parametrize('model', ['claude-sonnet-5', 'uncatalogued-seat-model', None])
def test_subscription_never_uses_api_catalog_to_pass_budget(residence, billing, model):
    """R-PRV-06 (#416): a subscription is outside the USD ceiling — its run is
    neither priced from the API catalog nor refused for lacking a price or a
    default model (F5 used to refuse it)."""
    async def go():
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 5)
            status = await ut.enforce_budget_or_raise(db, model=model, residence=residence, billing=billing, model_expected=True)
            assert status.state == 'ok'
    anyio.run(go)

def test_exhausted_usd_budget_still_stops_a_subscription_run():
    """The global stops (exceeded/invalid/unknown) still apply to every run."""
    async def go():
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 0)
            with pytest.raises(ut.BudgetExceededError, match='reached'):
                await ut.enforce_budget_or_raise(db, model=None, residence='cloud', billing='subscription', model_expected=True)
    anyio.run(go)

def test_unknown_history_blocks_and_summary_exposes_incomplete_cost(client):
    async def seed():
        async with SessionLocal() as db:
            args = usage_kwargs()
            args['model'] = 'uncatalogued'
            await ut.record_usage(db, **args)
            await ut.set_budget_limit(db, 5)
            with pytest.raises(ut.BudgetExceededError, match='unknown'):
                await ut.enforce_budget_or_raise(db)
    anyio.run(seed)
    body = client.get('/usage/summary').json()
    assert body['totalCostUsd'] == 0  # compatibility: known subtotal
    assert body['costComplete'] is False
    assert body['estimatedCostUsd'] is None
    assert body['byConnection'][0]['costComplete'] is False
    assert body['bySource'][0]['estimatedCostUsd'] is None
    assert body['budget']['state'] == 'unknown'

def test_intake_retry_is_idempotent_across_sessions_and_concurrent_writers():
    import asyncio
    async def go():
        async def write():
            async with SessionLocal() as db:
                return await ut.record_usage(db, **usage_kwargs(call_id='intake-1'))
        rows = await asyncio.gather(write(), write(), write())
        assert len({row.id for row in rows}) == 1
        async with SessionLocal() as db:
            assert await ut.total_spend_usd(db) == pytest.approx(0.0009)
        row = await write()
        assert row.id == rows[0].id
    anyio.run(go)

def test_budget_call_serializes_spend_until_persistence():
    import asyncio
    async def go():
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 0.0009)
        async def invoke(call_id):
            async with SessionLocal() as db:
                try:
                    async with ut.budget_call(db, model='claude-sonnet-5', residence='cloud', billing='credits'):
                        await asyncio.sleep(0)
                        await ut.record_usage(db, **usage_kwargs(call_id=call_id))
                        return 'spent'
                except ut.BudgetExceededError:
                    return 'blocked'
        assert sorted(await asyncio.gather(invoke('a'), invoke('b'))) == ['blocked', 'spent']
    anyio.run(go)

@pytest.mark.parametrize('failure', [RuntimeError, __import__('asyncio').CancelledError])
def test_budget_call_releases_after_failed_call_and_records_partial_usage(failure):
    import asyncio
    async def go():
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 1)
        async with SessionLocal() as db:
            with pytest.raises(failure):
                async with ut.budget_call(db, model='claude-sonnet-5', residence='cloud', billing='credits'):
                    try:
                        raise failure()
                    finally:
                        await ut.record_usage(db, **usage_kwargs(call_id='failed'))
        async def next_call():
            async with SessionLocal() as db:
                async with ut.budget_call(db, model='claude-sonnet-5', residence='cloud', billing='credits'):
                    assert await ut.total_spend_usd(db) == pytest.approx(0.0009)
        await asyncio.wait_for(next_call(), timeout=2)
    anyio.run(go)


def test_small_valid_budget_does_not_overflow_response(client):
    async def seed():
        async with SessionLocal() as db:
            await ut.record_usage(db, **usage_kwargs())
    anyio.run(seed)
    response = client.put('/usage/budget', json={'limitUsd': 5e-324})
    assert response.status_code == 200
    assert response.json()['state'] == 'exceeded'
    assert response.json()['pct'] is None
