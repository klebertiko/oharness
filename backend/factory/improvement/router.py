"""`/factory/improvements`: proposals, scores and the exportable decision trail.

Deciding, reverting and starting an analysis need the person's credential. Recording a
score does not: the run loop will call it. Reading is open to the sidecar token, like
the rest of the Forja.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from factory.auth import actor_for
from factory.improvement import benchmarks, service
from factory.improvement.orm import FactoryFailure
from factory.service import FactoryError
from factory import versions

router = APIRouter(prefix='/factory/improvements', tags=['factory'])


class AnalyzeBody(BaseModel):
    model_config = {'extra': 'ignore'}
    factory_id: str = Field(pattern=r'^[a-z0-9][a-z0-9-]{0,62}$')
    justification: str = Field(default='', max_length=4000)
    failure_ids: list[str] = Field(default_factory=list, max_length=100)
    after: dict | None = None
    notes: list[dict] = Field(default_factory=list, max_length=20)
    code_patch: str | None = Field(default=None, max_length=20000)


class RunBody(BaseModel):
    model_config = {'extra': 'ignore'}
    factory_id: str = Field(pattern=r'^[a-z0-9][a-z0-9-]{0,62}$')
    force: bool = False


class RecommendBody(BaseModel):
    model_config = {'extra': 'ignore'}
    trials: list[dict] = Field(min_length=2, max_length=20)


class ApplyBody(BaseModel):
    model_config = {'extra': 'ignore'}
    factory_id: str = Field(pattern=r'^[a-z0-9][a-z0-9-]{0,62}$')
    agent: str = Field(pattern=r'^[a-z0-9][a-z0-9-]{0,62}$')
    model: str = Field(min_length=1, max_length=100)


class DecideBody(BaseModel):
    model_config = {'extra': 'ignore'}
    action: str = Field(pattern=r'^(approve|request_changes|reject)$')
    note: str | None = Field(default=None, max_length=4000)


class ScoreBody(BaseModel):
    model_config = {'extra': 'ignore'}
    factory_id: str = Field(pattern=r'^[a-z0-9][a-z0-9-]{0,62}$')
    version_hash: str = Field(pattern=r'^[0-9a-f]{64}$')
    scorer_id: str = Field(pattern=r'^[a-z0-9][a-z0-9-]{0,62}$')
    run_id: str = Field(min_length=1, max_length=200)
    passed: bool | None = None
    score: float | None = None
    check: str | None = None
    evidence: dict = Field(default_factory=dict)
    passing_score: float | None = None
    agent_id: str | None = None
    stage: str | None = None
    work_item_id: str | None = None
    cost_tokens: int = 0
    interventions: int = 0
    label: str | None = None
    labels: list[dict] = Field(default_factory=list)


def _http(exc: FactoryError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail={'code': exc.code, 'message': exc.detail})


def _human(request: Request) -> tuple[str, str | None]:
    actor = actor_for(request)
    if actor[0] != 'human':
        raise HTTPException(status_code=403, detail={'code': 'human_only', 'message': 'This decision needs the human credential of the app.'})
    return actor


@router.get('')
async def list_improvements(factory_id: str | None = None, db: AsyncSession = Depends(get_db)):
    rows = await service.proposals(db, factory_id)
    found = await service.failures(db, factory_id)
    exported = await service.export_events(db, factory_id)
    return {'proposals': [service.proposal_json(row) for row in rows], 'failures': [service.failure_json(row) for row in found], 'events': exported['events']}


@router.get('/export')
async def export(factory_id: str | None = None, db: AsyncSession = Depends(get_db)):
    return await service.export_events(db, factory_id)


@router.post('/analyze')
async def analyze(body: AnalyzeBody, request: Request, db: AsyncSession = Depends(get_db)):
    actor = _human(request)
    current = await versions.state(db, body.factory_id)
    if current.stable is None:
        raise HTTPException(status_code=409, detail={'code': 'no_stable', 'message': 'There is no active definition to improve.'})
    before = json.loads(current.stable.definition_json)
    named = []
    if body.failure_ids:
        for failure_id in body.failure_ids:
            row = await db.get(FactoryFailure, failure_id)
            if row is not None and row.factory_id == body.factory_id:
                named.append({'id': row.id, 'agent_id': row.agent_id, 'reason': row.reason})
    after = body.after if body.after is not None else service.draft_after(before, named)
    try:
        proposal = await service.propose(db, factory_id=body.factory_id, before=before, after=after, actor=actor,
                                         justification=body.justification, failure_ids=[row['id'] for row in named] or body.failure_ids,
                                         analyst=(before.get('selfImprovement') or {}).get('analyst'), notes=body.notes,
                                         code_patch=body.code_patch)
    except FactoryError as exc:
        raise _http(exc) from None
    return service.proposal_json(proposal)


@router.post('/score')
async def score(body: ScoreBody, db: AsyncSession = Depends(get_db)):
    try:
        row = await service.record_score(
            db, factory_id=body.factory_id, version_hash=body.version_hash, scorer_id=body.scorer_id, run_id=body.run_id,
            passed=body.passed, score=body.score, check=body.check, evidence=body.evidence, passing_score=body.passing_score,
            agent_id=body.agent_id, stage=body.stage, work_item_id=body.work_item_id, cost_tokens=body.cost_tokens,
            interventions=body.interventions, label=body.label, labels=body.labels)
    except FactoryError as exc:
        raise _http(exc) from None
    return {'id': row.id, 'passed': row.passed, 'score': row.score, 'reason': row.reason}


@router.post('/run')
async def run_check(body: RunBody, request: Request, db: AsyncSession = Depends(get_db)):
    try:
        return await service.run_check(db, body.factory_id, _human(request), force=body.force)
    except FactoryError as exc:
        raise _http(exc) from None


@router.post('/benchmarks/recommend')
async def recommend(body: RecommendBody):
    try:
        return benchmarks.recommend(body.trials)
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=422, detail={'code': 'invalid_trials', 'message': 'Each trial needs a name, quality, cost and seconds.'}) from None


@router.post('/benchmarks/apply')
async def apply_benchmark(body: ApplyBody, request: Request, db: AsyncSession = Depends(get_db)):
    actor = _human(request)
    current = await versions.state(db, body.factory_id)
    if current.stable is None:
        raise HTTPException(status_code=409, detail={'code': 'no_stable', 'message': 'There is no active definition to improve.'})
    before = json.loads(current.stable.definition_json)
    if body.agent not in before.get('agents', {}):
        raise HTTPException(status_code=404, detail={'code': 'not_found', 'message': 'That agent is not in the active definition.'})
    after = benchmarks.apply_model(before, body.agent, body.model)
    try:
        proposal = await service.propose(db, factory_id=body.factory_id, before=before, after=after, actor=actor,
                                         justification=f'Use the benchmark result for {body.agent}.', analyst=(before.get('selfImprovement') or {}).get('analyst'))
    except FactoryError as exc:
        raise _http(exc) from None
    return service.proposal_json(proposal)


@router.post('/{proposal_id}/decide')
async def decide(proposal_id: str, body: DecideBody, request: Request, db: AsyncSession = Depends(get_db)):
    try:
        proposal = await service.decide(db, proposal_id, body.action, _human(request), body.note)
    except FactoryError as exc:
        raise _http(exc) from None
    return service.proposal_json(proposal)


@router.post('/{proposal_id}/measure')
async def measure(proposal_id: str, db: AsyncSession = Depends(get_db)):
    try:
        return await service.measure(db, proposal_id)
    except FactoryError as exc:
        raise _http(exc) from None


@router.post('/{proposal_id}/revert')
async def revert(proposal_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    try:
        proposal = await service.revert(db, proposal_id, _human(request))
    except FactoryError as exc:
        raise _http(exc) from None
    return service.proposal_json(proposal)


@router.post('/{proposal_id}/promoted')
async def promoted(proposal_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    try:
        proposal = await service.mark_promoted(db, proposal_id, _human(request))
    except FactoryError as exc:
        raise _http(exc) from None
    return service.proposal_json(proposal)


@router.delete('/{proposal_id}/notes/{note_id}')
async def revoke_note(proposal_id: str, note_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    try:
        await service.revoke_note(db, proposal_id, note_id, _human(request))
    except FactoryError as exc:
        raise _http(exc) from None
    return {'ok': True}
