"""Propose a definition change, let a person decide, measure the trial, and roll it back.

Nothing here writes the active definition except through the existing version log: approving
starts a canary, a worse result aborts that canary, and promoting stays a separate human
action. Every step appends an event.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from factory import memory, versions
from factory.definition import diff, hash_of
from factory.improvement import limits
from factory.improvement.orm import FactoryFailure, FactoryScore, ImprovementEvent, ImprovementProposal
from factory.scorers.evaluate import evaluate
from factory.service import FactoryError

NOTE = 'Ask a person before repeating a step that already failed a recorded check.'
_MERGE_LINE = re.compile(r'(?im)^\s*action\s*:\s*merge\s*$')
DEFAULT_FAILURES = 25
DEFAULT_AGE_DAYS = 7


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def wilson(passed: int, total: int, z: float = 1.96) -> tuple[float, float]:
    """Confidence interval for a pass rate. An empty sample covers the whole range."""
    if total <= 0:
        return 0.0, 1.0
    proportion = passed / total
    z2 = z * z
    denom = 1 + z2 / total
    centre = proportion + z2 / (2 * total)
    margin = z * math.sqrt(proportion * (1 - proportion) / total + z2 / (4 * total * total))
    return max(0.0, (centre - margin) / denom), min(1.0, (centre + margin) / denom)


def compare(baseline: list[bool], trial: list[bool]) -> str:
    """`improved`, `tied` or `worsened` from the two pass-rate intervals. No baseline means tied."""
    if not baseline or not trial:
        return 'tied'
    base_low, base_high = wilson(sum(baseline), len(baseline))
    trial_low, trial_high = wilson(sum(trial), len(trial))
    if trial_high < base_low:
        return 'worsened'
    if trial_low > base_high:
        return 'improved'
    return 'tied'


def sampled(run_id: str, scorer_id: str, rate: float) -> bool:
    """True when this run falls in the scorer's sample. The same ids always land on the same side."""
    if rate <= 0:
        return False
    if rate >= 100:
        return True
    bucket = int(hashlib.sha256(f'{scorer_id}:{run_id}'.encode('utf-8')).hexdigest()[:8], 16) % 10000
    return bucket < int(round(rate * 100))


def classify(label: str, labels: list[dict], passing_score: float) -> tuple[bool, float, str]:
    """A classification is one declared label. Passing is its score against the threshold."""
    found = next((item for item in labels if item.get('value') == label), None)
    if found is None or not isinstance(found.get('score'), (int, float)):
        raise ValueError(label)
    score = float(found['score'])
    return score >= passing_score, score, label


def schedule_due(count: int, oldest: datetime | None, now: datetime, *, threshold: int = DEFAULT_FAILURES,
                 age_days: int = DEFAULT_AGE_DAYS, force: bool = False) -> bool:
    """A scheduled check starts at `threshold` open failures, or when the oldest is `age_days` old. Force needs one."""
    if count <= 0:
        return False
    if force:
        return True
    if count >= threshold:
        return True
    return oldest is not None and now - oldest >= timedelta(days=age_days)


def draft_after(before: dict, failures: list[dict]) -> dict:
    """A candidate that only adds a sentence to the agent the failures name. It does not touch gates."""
    after = copy.deepcopy(before)
    agents = after.get('agents') or {}
    counts: dict[str, int] = {}
    for failure in failures:
        agent = failure.get('agent_id')
        if isinstance(agent, str):
            counts[agent] = counts.get(agent, 0) + 1
    target = max(counts, key=counts.get) if counts else next(iter(agents), None)
    agent = agents.get(target) if isinstance(target, str) else None
    if isinstance(agent, dict) and isinstance(agent.get('instructions'), str) and NOTE not in agent['instructions']:
        agent['instructions'] = agent['instructions'].rstrip() + '\n' + NOTE
    return after


def _iso(moment: datetime | None) -> str | None:
    return moment.isoformat() + 'Z' if moment else None


def _loads(text: str, fallback):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return fallback


async def _event(db: AsyncSession, proposal: ImprovementProposal, type_: str, actor: tuple[str, str | None], data: dict | None = None) -> ImprovementEvent:
    row = ImprovementEvent(proposal_id=proposal.id, factory_id=proposal.factory_id, type=type_, actor_kind=actor[0],
                           actor_id=actor[1], data_json=json.dumps(data or {}, sort_keys=True))
    db.add(row)
    await db.flush()
    return row


def _estimate(before: dict, after: dict) -> int:
    return max(1, abs(len(json.dumps(after, sort_keys=True)) - len(json.dumps(before, sort_keys=True))) // 4)


def _code_merge(patch: str) -> dict | None:
    if _MERGE_LINE.search(patch):
        return {'code': 'add_merge', 'path': '$code', 'message': 'The proposal adds a merge. The Forja never merges.'}
    return None


def _is_code(proposal: ImprovementProposal) -> bool:
    return any(isinstance(change, dict) and change.get('path') == '$code' for change in _loads(proposal.diff_json, []))


async def propose(db: AsyncSession, *, factory_id: str, before: dict, after: dict, actor: tuple[str, str | None],
                  justification: str, failure_ids: list[str] | None = None, analyst: str | None = None,
                  notes: list[dict] | None = None, code_patch: str | None = None) -> ImprovementProposal:
    if code_patch is None and hash_of(before) == hash_of(after):
        raise FactoryError('unchanged', 409, 'The proposal does not change the definition.')
    if code_patch is not None:
        reasons = [limits_reason] if (limits_reason := _code_merge(code_patch)) else []
        changes = [{'path': '$code', 'op': 'changed', 'before': None, 'after': code_patch[:20000]}]
    else:
        reasons = limits.check(before, after)
        changes = [change.as_dict() for change in diff(before, after)]
    proposal = ImprovementProposal(
        factory_id=factory_id, status='rejected' if reasons else 'pending', analyst=analyst,
        before_hash=hash_of(before), after_hash=hash_of(after), before_json=json.dumps(before, sort_keys=True),
        after_json=json.dumps(after, sort_keys=True), diff_json=json.dumps(changes), justification=justification[:4000],
        estimated_tokens=_estimate(before, after), failure_ids_json=json.dumps(failure_ids or []),
        notes_json=json.dumps(notes or []), rejection_json=json.dumps(reasons) if reasons else None,
    )
    db.add(proposal)
    await db.flush()
    await _event(db, proposal, 'rejected_by_validator' if reasons else 'proposed', actor,
                 {'reasons': reasons, 'failure_ids': failure_ids or [], 'diff_count': len(changes)})
    await db.commit()
    return proposal


async def decide(db: AsyncSession, proposal_id: str, action: str, actor: tuple[str, str | None], note: str | None = None) -> ImprovementProposal:
    if actor[0] != 'human':
        raise FactoryError('human_only', 403, 'Approving, rejecting or sending a proposal back needs the human credential.')
    proposal = await db.get(ImprovementProposal, proposal_id)
    if proposal is None:
        raise FactoryError('not_found', 404)
    if proposal.status != 'pending':
        raise FactoryError('not_pending', 409, 'This proposal is not waiting for a decision.')
    if action == 'approve' and _is_code(proposal):
        proposal.status = 'approved'
        proposal.decided_at = _now()
        proposal.decided_by = actor[1]
        await _event(db, proposal, 'approved', actor, {'note': note or '', 'target': 'code', 'failure_ids': _loads(proposal.failure_ids_json, [])})
    elif action == 'approve':
        after = json.loads(proposal.after_json)
        percent = int((after.get('selfImprovement') or {}).get('canaryPercent') or 10)
        await versions.activate(db, after, proposal.after_hash, actor[1] or 'human', mode='canary', percent=percent, label='improvement')
        proposal.status = 'canary'
        proposal.canary_percent = percent
        proposal.decided_at = _now()
        proposal.decided_by = actor[1]
        await _event(db, proposal, 'approved', actor, {'note': note or '', 'target': 'definition', 'failure_ids': _loads(proposal.failure_ids_json, [])})
        await _event(db, proposal, 'canary_started', actor, {'percent': percent, 'hash': proposal.after_hash})
        await _apply_notes(db, proposal, actor)
    elif action == 'request_changes':
        proposal.status = 'changes_requested'
        proposal.decided_at = _now()
        proposal.decided_by = actor[1]
        await _event(db, proposal, 'changes_requested', actor, {'note': note or ''})
    elif action == 'reject':
        proposal.status = 'rejected_by_human'
        proposal.decided_at = _now()
        proposal.decided_by = actor[1]
        await _event(db, proposal, 'rejected', actor, {'note': note or ''})
    else:
        raise FactoryError('unknown_action', 422, 'action is approve, request_changes or reject.')
    await db.commit()
    return proposal


async def _apply_notes(db: AsyncSession, proposal: ImprovementProposal, actor: tuple[str, str | None]) -> None:
    created = []
    for note in _loads(proposal.notes_json, []):
        if not isinstance(note, dict):
            continue
        agent, text = note.get('agent_id'), note.get('text')
        if not isinstance(agent, str) or not isinstance(text, str) or not text.strip():
            continue
        try:
            row = await memory.add(db, proposal.factory_id, agent, text, origin='agent')
        except FactoryError as exc:
            await _event(db, proposal, 'memory_skipped', actor, {'agent_id': agent, 'code': exc.code})
            continue
        created.append(row.id)
    if created:
        await _event(db, proposal, 'memory_added', actor, {'note_ids': created})


async def revoke_note(db: AsyncSession, proposal_id: str, note_id: str, actor: tuple[str, str | None]) -> None:
    if actor[0] != 'human':
        raise FactoryError('human_only', 403, 'Revoking a note needs the human credential.')
    proposal = await db.get(ImprovementProposal, proposal_id)
    if proposal is None:
        raise FactoryError('not_found', 404)
    added = [event for event in await _events(db, proposal_id) if event.type == 'memory_added']
    known = {note for event in added for note in _loads(event.data_json, {}).get('note_ids', [])}
    if note_id not in known:
        raise FactoryError('not_found', 404, 'That note did not come from this proposal.')
    await memory.remove(db, note_id)
    proposal = await db.get(ImprovementProposal, proposal_id)
    await _event(db, proposal, 'memory_revoked', actor, {'note_id': note_id})
    await db.commit()


async def measure(db: AsyncSession, proposal_id: str, *, now: datetime | None = None) -> dict:
    proposal = await db.get(ImprovementProposal, proposal_id)
    if proposal is None:
        raise FactoryError('not_found', 404)
    if proposal.status != 'canary':
        raise FactoryError('not_canary', 409, 'Only a trial can be measured.')
    after = json.loads(proposal.after_json)
    settings = after.get('selfImprovement') or {}
    minimum = int(settings.get('minSampleRuns') or 20)
    days = int(settings.get('sampleDays') or 7)
    baseline = await _flags(db, proposal.factory_id, proposal.before_hash)
    trial = await _flags(db, proposal.factory_id, proposal.after_hash)
    moment = now or _now()
    started = proposal.decided_at or proposal.created_at
    aged = bool(trial) and moment - started >= timedelta(days=days)
    if len(trial) < minimum and not aged:
        await _event(db, proposal, 'measured', ('system', None), {'verdict': None, 'reason': 'sample', 'trial': len(trial), 'minimum': minimum})
        await db.commit()
        return {'verdict': None, 'reason': 'sample', 'trial': len(trial), 'minimum': minimum}
    result = compare(baseline, trial)
    base_low, base_high = wilson(sum(baseline), len(baseline))
    trial_low, trial_high = wilson(sum(trial), len(trial))
    summary = {'verdict': result, 'baseline': {'n': len(baseline), 'low': base_low, 'high': base_high},
               'trial': {'n': len(trial), 'low': trial_low, 'high': trial_high}}
    await _event(db, proposal, 'measured', ('system', None), summary)
    proposal.verdict = result
    if result == 'worsened':
        await versions.abort(db, proposal.factory_id, 'system')
        proposal.status = 'rolled_back'
        await _event(db, proposal, 'rolled_back', ('system', None), {'reason': 'worsened', 'hash': proposal.before_hash})
    await db.commit()
    return summary


async def revert(db: AsyncSession, proposal_id: str, actor: tuple[str, str | None]) -> ImprovementProposal:
    """A person undoes a trial or, once it was promoted, the version it became."""
    if actor[0] != 'human':
        raise FactoryError('human_only', 403, 'Reverting a proposal needs the human credential.')
    proposal = await db.get(ImprovementProposal, proposal_id)
    if proposal is None:
        raise FactoryError('not_found', 404)
    if proposal.status == 'canary':
        await versions.abort(db, proposal.factory_id, actor[1] or 'human')
    elif proposal.status == 'promoted':
        await versions.rollback(db, proposal.factory_id, actor[1] or 'human', proposal.before_hash)
    else:
        raise FactoryError('nothing_to_revert', 409, 'This proposal has no trial to undo.')
    proposal.status = 'rolled_back'
    proposal.verdict = proposal.verdict or 'reverted'
    await _event(db, proposal, 'reverted', actor, {'hash': proposal.before_hash})
    await db.commit()
    return proposal


async def mark_promoted(db: AsyncSession, proposal_id: str, actor: tuple[str, str | None]) -> ImprovementProposal:
    """Record that a person promoted the trial. The version change itself is the existing promote route."""
    if actor[0] != 'human':
        raise FactoryError('human_only', 403, 'Promoting a trial needs the human credential.')
    proposal = await db.get(ImprovementProposal, proposal_id)
    if proposal is None or proposal.status != 'canary' or proposal.verdict != 'improved':
        raise FactoryError('not_ready', 409, 'Promote is offered only after the trial measured as improved.')
    proposal.status = 'promoted'
    await _event(db, proposal, 'promoted', actor, {'hash': proposal.after_hash})
    await db.commit()
    return proposal


async def record_score(db: AsyncSession, *, factory_id: str, version_hash: str, scorer_id: str, run_id: str,
                       passed: bool | None = None, score: float | None = None, check: str | None = None,
                       evidence: dict | None = None, passing_score: float | None = None, agent_id: str | None = None,
                       stage: str | None = None, work_item_id: str | None = None, cost_tokens: int = 0,
                       interventions: int = 0, kind: str = 'deterministic', label: str | None = None,
                       labels: list[dict] | None = None) -> FactoryScore:
    """The latest call for a run and a scorer replaces the previous result."""
    reason = ''
    if label is not None:
        try:
            passed, score, reason = classify(label, labels or [], 1 if passing_score is None else passing_score)
        except ValueError:
            raise FactoryError('unknown_label', 422, 'That classification is not one this scorer declares.') from None
        kind = 'classification'
    elif passed is None:
        if not check:
            raise FactoryError('missing_fields', 422, 'A score needs a result or a check.')
        try:
            passed, score, reason = evaluate(check, evidence)
        except ValueError:
            raise FactoryError('unknown_check', 422, 'That check is not one the Forja runs.') from None
    score = (1.0 if passed else 0.0) if score is None else float(score)
    if passing_score is not None and score < passing_score:
        passed = False
    for old in await db.scalars(select(FactoryScore).where(FactoryScore.factory_id == factory_id, FactoryScore.scorer_id == scorer_id, FactoryScore.run_id == run_id)):
        await db.delete(old)
    for old in await db.scalars(select(FactoryFailure).where(FactoryFailure.factory_id == factory_id, FactoryFailure.scorer_id == scorer_id, FactoryFailure.run_id == run_id)):
        await db.delete(old)
    await db.flush()
    row = FactoryScore(factory_id=factory_id, version_hash=version_hash, scorer_id=scorer_id, run_id=run_id,
                       work_item_id=work_item_id, agent_id=agent_id, stage=stage, passed=bool(passed), score=score,
                       cost_tokens=cost_tokens, interventions=interventions, reason=reason)
    db.add(row)
    await db.flush()
    if not passed:
        db.add(FactoryFailure(factory_id=factory_id, agent_id=agent_id, stage=stage, kind=kind, scorer_id=scorer_id,
                              run_id=run_id, work_item_id=work_item_id, score=score, passing_score=passing_score,
                              reason=reason or check or 'below the pass line',
                              evidence_json=json.dumps(evidence or {}, sort_keys=True)[:4000]))
    await db.commit()
    return row


async def _flags(db: AsyncSession, factory_id: str, version_hash: str) -> list[bool]:
    rows = await db.scalars(select(FactoryScore).where(FactoryScore.factory_id == factory_id, FactoryScore.version_hash == version_hash)
                            .order_by(FactoryScore.at))
    return [row.passed for row in rows]


async def _events(db: AsyncSession, proposal_id: str) -> list[ImprovementEvent]:
    return list(await db.scalars(select(ImprovementEvent).where(ImprovementEvent.proposal_id == proposal_id).order_by(ImprovementEvent.id)))


async def run_check(db: AsyncSession, factory_id: str, actor: tuple[str, str | None], *, force: bool = False) -> dict:
    """Start a proposal when enough failures are still open, or when a person asks to run it now."""
    if actor[0] != 'human':
        raise FactoryError('human_only', 403, 'Starting an improvement check needs the human credential.')
    current = await versions.state(db, factory_id)
    if current.stable is None:
        raise FactoryError('no_stable', 409, 'There is no active definition to improve.')
    before = json.loads(current.stable.definition_json)
    settings = before.get('selfImprovement') or {}
    threshold = int(settings.get('failureThreshold') or DEFAULT_FAILURES)
    age_days = int(settings.get('ageDays') or DEFAULT_AGE_DAYS)
    linked: set[str] = set()
    for proposal in await proposals(db, factory_id):
        if proposal.status != 'rejected':
            linked.update(_loads(proposal.failure_ids_json, []))
    open_rows = [row for row in await failures(db, factory_id) if row.id not in linked]
    oldest = min((row.at for row in open_rows), default=None)
    if not schedule_due(len(open_rows), oldest, _now(), threshold=threshold, age_days=age_days, force=force):
        return {'started': False, 'reason': 'threshold', 'open': len(open_rows)}
    after = draft_after(before, [{'agent_id': row.agent_id, 'reason': row.reason} for row in open_rows])
    proposal = await propose(db, factory_id=factory_id, before=before, after=after, actor=actor,
                             justification='Open failures for the same agent.', failure_ids=[row.id for row in open_rows],
                             analyst=settings.get('analyst'))
    return {'started': proposal.status == 'pending', 'reason': None if proposal.status == 'pending' else 'rejected', 'proposal': proposal_json(proposal)}


async def proposals(db: AsyncSession, factory_id: str | None = None) -> list[ImprovementProposal]:
    query = select(ImprovementProposal).order_by(ImprovementProposal.created_at.desc())
    if factory_id:
        query = query.where(ImprovementProposal.factory_id == factory_id)
    return list(await db.scalars(query))


async def failures(db: AsyncSession, factory_id: str | None = None) -> list[FactoryFailure]:
    query = select(FactoryFailure).order_by(FactoryFailure.at.desc()).limit(200)
    if factory_id:
        query = query.where(FactoryFailure.factory_id == factory_id)
    return list(await db.scalars(query))


async def export_events(db: AsyncSession, factory_id: str | None = None) -> dict:
    query = select(ImprovementEvent).order_by(ImprovementEvent.id)
    if factory_id:
        query = query.where(ImprovementEvent.factory_id == factory_id)
    rows = list(await db.scalars(query))
    return {'events': [_event_json(row) for row in rows]}


def proposal_json(row: ImprovementProposal) -> dict:
    return {
        'id': row.id, 'factory_id': row.factory_id, 'status': row.status, 'analyst': row.analyst,
        'before_hash': row.before_hash, 'after_hash': row.after_hash, 'justification': row.justification,
        'estimated_tokens': row.estimated_tokens, 'failure_ids': _loads(row.failure_ids_json, []),
        'reasons': _loads(row.rejection_json, []) if row.rejection_json else [],
        'verdict': row.verdict, 'canary_percent': row.canary_percent, 'diff': _loads(row.diff_json, []),
        'target': 'code' if _is_code(row) else 'definition',
        'created_at': _iso(row.created_at), 'decided_at': _iso(row.decided_at), 'decided_by': row.decided_by,
    }


def failure_json(row: FactoryFailure) -> dict:
    return {
        'id': row.id, 'factory_id': row.factory_id, 'agent_id': row.agent_id, 'stage': row.stage, 'kind': row.kind,
        'scorer_id': row.scorer_id, 'run_id': row.run_id, 'work_item_id': row.work_item_id, 'score': row.score,
        'passing_score': row.passing_score, 'reason': row.reason, 'at': _iso(row.at),
    }


def _event_json(row: ImprovementEvent) -> dict:
    return {
        'id': row.id, 'proposal_id': row.proposal_id, 'factory_id': row.factory_id, 'type': row.type,
        'actor': {'kind': row.actor_kind, 'id': row.actor_id}, 'data': _loads(row.data_json, {}), 'at': _iso(row.at),
    }
