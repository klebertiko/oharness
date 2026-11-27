"""`/factory/improvements`: proposals, scores and the exportable decision trail.

Deciding, measuring, reverting, promoting and starting an analysis need the person's
credential. Recording a score needs the run loop's own credential (held in this process
only) or the person's: the ordinary sidecar token an agent holds cannot score. Reading is
open to the sidecar token, like the rest of the Forja, one page at a time.
"""
from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from factory import definition_rules as rules
from factory.auth import actor_for, is_scorer
from factory.improvement import benchmarks, service
from factory.improvement.orm import FactoryFailure
from factory.service import FactoryError
from factory import versions

router = APIRouter(prefix='/factory/improvements', tags=['factory'])

ID = rules.ID_PATTERN
ROW_ID = r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
RUN_ID = r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
RowId = Annotated[str, Path(pattern=ROW_ID)]


def _depth(value) -> int:
    """How deep the mapping nests, walked without recursion so a deep value cannot exhaust the stack."""
    deepest, stack = 0, [(value, 1)]
    while stack:
        node, level = stack.pop()
        deepest = max(deepest, level)
        if level > rules.MAX_YAML_DEPTH:
            return level
        children = node.values() if isinstance(node, dict) else node if isinstance(node, list) else ()
        stack.extend((child, level + 1) for child in children if isinstance(child, (dict, list)))
    return deepest


class NoteBody(BaseModel):
    model_config = {'extra': 'forbid'}
    agent_id: str = Field(pattern=ID)
    text: str = Field(min_length=1, max_length=rules.MEMORY_LIMITS['maxNoteChars'])


class AnalyzeBody(BaseModel):
    model_config = {'extra': 'forbid'}
    factory_id: str = Field(pattern=ID)
    justification: str = Field(default='', max_length=4000)
    failure_ids: list[Annotated[str, Field(pattern=ROW_ID)]] = Field(default_factory=list, max_length=100)
    after: dict | None = None
    notes: list[NoteBody] = Field(default_factory=list, max_length=20)
    code_patch: str | None = Field(default=None, max_length=20000)

    @field_validator('after')
    @classmethod
    def _bounded(cls, value):
        if value is not None and _depth(value) > rules.MAX_YAML_DEPTH:
            raise ValueError(f'the proposed definition nests deeper than {rules.MAX_YAML_DEPTH} levels')
        if value is not None and len(json.dumps(value)) > rules.MAX_TOTAL_BYTES:
            raise ValueError('the proposed definition is too large')
        return value


class RunBody(BaseModel):
    model_config = {'extra': 'ignore'}
    factory_id: str = Field(pattern=r'^[a-z0-9][a-z0-9-]{0,62}$')
    force: bool = False


class TrialBody(BaseModel):
    model_config = {'extra': 'forbid'}
    name: str = Field(min_length=1, max_length=100)
    quality: float = Field(ge=0, le=1, allow_inf_nan=False)
    cost: float = Field(ge=0, le=1e12, allow_inf_nan=False)
    seconds: float = Field(ge=0, le=1e9, allow_inf_nan=False)


class RecommendBody(BaseModel):
    model_config = {'extra': 'forbid'}
    trials: list[TrialBody] = Field(min_length=2, max_length=20)


class ApplyBody(BaseModel):
    model_config = {'extra': 'forbid'}
    factory_id: str = Field(pattern=ID)
    agent: str = Field(pattern=ID)
    model: str = Field(pattern=rules.MODEL_PATTERN)


class DecideBody(BaseModel):
    model_config = {'extra': 'ignore'}
    action: str = Field(pattern=r'^(approve|request_changes|reject)$')
    note: str | None = Field(default=None, max_length=4000)


class ScoreBody(BaseModel):
    """The pass line, the labels, the check and its caps come from the definition: a caller cannot send them."""
    model_config = {'extra': 'forbid'}
    factory_id: str = Field(pattern=ID)
    version_hash: str = Field(pattern=r'^[0-9a-f]{64}$')
    scorer_id: str = Field(pattern=ID)
    run_id: str = Field(pattern=RUN_ID)
    passed: bool | None = None
    score: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    evidence: dict = Field(default_factory=dict)
    agent_id: str | None = Field(default=None, pattern=ID)
    stage: str | None = Field(default=None, pattern=ID, max_length=16)
    work_item_id: str | None = Field(default=None, pattern=RUN_ID)
    cost_tokens: int = Field(default=0, ge=0, le=rules.MAX_TOKENS_CAP)
    interventions: int = Field(default=0, ge=0, le=10_000)
    label: str | None = Field(default=None, pattern=ID)

    @field_validator('evidence')
    @classmethod
    def _small(cls, value):
        if len(json.dumps(value)) > 4000:
            raise ValueError('evidence holds at most 4000 bytes')
        return value


def _http(exc: FactoryError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail={'code': exc.code, 'message': exc.detail})


def _human(request: Request) -> tuple[str, str | None]:
    actor = actor_for(request)
    if actor[0] != 'human':
        raise HTTPException(status_code=403, detail={'code': 'human_only', 'message': 'This decision needs the human credential of the app.'})
    return actor


FactoryQuery = Annotated[str | None, Query(pattern=ID)]


@router.get('')
async def list_improvements(factory_id: FactoryQuery = None, limit: Annotated[int, Query(ge=1, le=500)] = 200,
                            db: AsyncSession = Depends(get_db)):
    rows = await service.proposals(db, factory_id, limit=limit)
    found = await service.failures(db, factory_id)
    replaced = await service.superseded(db, found)
    exported = await service.export_events(db, factory_id, limit=limit)
    return {'proposals': [service.proposal_json(row) for row in rows],
            'failures': [service.failure_json(row, row.id in replaced) for row in found],
            'events': exported['events'], 'next': exported['next']}


@router.get('/export')
async def export(factory_id: FactoryQuery = None, after_id: Annotated[int | None, Query(ge=0)] = None,
                 limit: Annotated[int, Query(ge=1, le=1000)] = 500, db: AsyncSession = Depends(get_db)):
    return await service.export_events(db, factory_id, after_id=after_id, limit=limit)


@router.post('/analyze')
async def analyze(body: AnalyzeBody, request: Request, db: AsyncSession = Depends(get_db)):
    actor = _human(request)
    current = await versions.state(db, body.factory_id)
    if current.stable is None:
        raise HTTPException(status_code=409, detail={'code': 'no_stable', 'message': 'There is no active definition to improve.'})
    before = json.loads(current.stable.definition_json)
    named = []
    for failure_id in dict.fromkeys(body.failure_ids):
        row = await db.get(FactoryFailure, failure_id)
        if row is None or row.factory_id != body.factory_id:
            raise HTTPException(status_code=422, detail={'code': 'unknown_failure', 'message': 'A failure id is not one of this factory.'})
        named.append({'id': row.id, 'agent_id': row.agent_id, 'reason': row.reason})
    after = body.after if body.after is not None else service.draft_after(before, named)
    try:
        proposal = await service.propose(db, factory_id=body.factory_id, before=before, after=after, actor=actor,
                                         justification=body.justification, failure_ids=[row['id'] for row in named],
                                         analyst=(before.get('selfImprovement') or {}).get('analyst'),
                                         notes=[note.model_dump() for note in body.notes], code_patch=body.code_patch)
    except FactoryError as exc:
        raise _http(exc) from None
    return service.proposal_json(proposal)


@router.post('/score')
async def score(body: ScoreBody, request: Request, db: AsyncSession = Depends(get_db)):
    if is_scorer(request):
        origin = 'run_loop'
    elif actor_for(request)[0] == 'human':
        origin = 'human'
    else:
        raise HTTPException(status_code=403, detail={'code': 'scorer_only', 'message': 'A score comes from the run loop or from a person.'})
    try:
        row = await service.record_score(
            db, factory_id=body.factory_id, version_hash=body.version_hash, scorer_id=body.scorer_id, run_id=body.run_id,
            origin=origin, passed=body.passed, score=body.score, evidence=body.evidence, agent_id=body.agent_id, stage=body.stage,
            work_item_id=body.work_item_id, cost_tokens=body.cost_tokens, interventions=body.interventions, label=body.label)
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
        return benchmarks.recommend([trial.model_dump() for trial in body.trials])
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
async def decide(proposal_id: RowId, body: DecideBody, request: Request, db: AsyncSession = Depends(get_db)):
    try:
        proposal = await service.decide(db, proposal_id, body.action, _human(request), body.note)
    except FactoryError as exc:
        raise _http(exc) from None
    return service.proposal_json(proposal)


@router.post('/{proposal_id}/measure')
async def measure(proposal_id: RowId, request: Request, db: AsyncSession = Depends(get_db)):
    try:
        return await service.measure(db, proposal_id, _human(request))
    except FactoryError as exc:
        raise _http(exc) from None


@router.post('/{proposal_id}/revert')
async def revert(proposal_id: RowId, request: Request, db: AsyncSession = Depends(get_db)):
    try:
        proposal = await service.revert(db, proposal_id, _human(request))
    except FactoryError as exc:
        raise _http(exc) from None
    return service.proposal_json(proposal)


@router.post('/{proposal_id}/promoted')
async def promoted(proposal_id: RowId, request: Request, db: AsyncSession = Depends(get_db)):
    try:
        proposal = await service.mark_promoted(db, proposal_id, _human(request))
    except FactoryError as exc:
        raise _http(exc) from None
    return service.proposal_json(proposal)


@router.delete('/{proposal_id}/notes/{note_id}')
async def revoke_note(proposal_id: RowId, note_id: RowId, request: Request, db: AsyncSession = Depends(get_db)):
    try:
        await service.revoke_note(db, proposal_id, note_id, _human(request))
    except FactoryError as exc:
        raise _http(exc) from None
    return {'ok': True}
