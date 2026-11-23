"""Propose a definition change, let a person decide, measure the trial, and roll it back.

Nothing here writes the active definition except through the existing version log: approving
starts a canary, a worse result aborts that canary, and promoting stays a separate human
action. Every step appends an event. Deciding, measuring, reverting and promoting need the
person's credential; a score needs the run loop's own credential or the person's, names the
active version or the trial, and takes its pass line from the definition, never the caller.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from factory import definition_rules as rules
from factory import memory, versions
from factory.definition import diff, hash_of, looks_secret, validate
from factory.improvement import limits
from factory.improvement.orm import FactoryFailure, FactoryScore, ImprovementEvent, ImprovementProposal
from factory.orm import WorkItem
from factory.scorers.evaluate import evaluate
from factory.service import FactoryError

NOTE = 'Ask a person before repeating a step that already failed a recorded check.'
DEFAULT_FAILURES = rules.SELF_IMPROVEMENT_DEFAULTS['failureThreshold']
DEFAULT_AGE_DAYS = rules.SELF_IMPROVEMENT_DEFAULTS['ageDays']
EVIDENCE_MAX_BYTES = 4000


def _settings(definition: dict) -> dict:
    return {**rules.SELF_IMPROVEMENT_DEFAULTS, **(definition.get('selfImprovement') or {})}


def _human_only(actor: tuple[str, str | None], what: str) -> None:
    if actor[0] != 'human':
        raise FactoryError('human_only', 403, f'{what} needs the human credential.')


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


def _strings(node):
    if isinstance(node, dict):
        for key, value in node.items():
            yield str(key)
            yield from _strings(value)
    elif isinstance(node, list):
        for value in node:
            yield from _strings(value)
    elif isinstance(node, str):
        yield node


def _refuse_secrets(*nodes) -> None:
    """Nothing that looks like a credential is stored, not even in a refused proposal."""
    if any(looks_secret(text) for node in nodes for text in _strings(node)):
        raise FactoryError('looks_secret', 422, 'A value looks like a credential. Keep secrets in the secrets store and reference them.')


def _definition_reasons(factory_id: str, before: dict, after: dict) -> list[dict]:
    reasons = limits.check(before, after)
    if after.get('name') != factory_id:
        reasons.append({'code': 'wrong_factory', 'path': 'name', 'message': 'The proposal is for another factory.'})
    for issue in validate(after):
        if issue.severity == 'error':
            reasons.append({'code': 'invalid_definition', 'path': issue.path, 'message': issue.message})
    return reasons


def _note_reasons(definition: dict, notes: list[dict]) -> list[dict]:
    reasons = []
    agents = definition.get('agents') or {}
    for index, note in enumerate(notes):
        if note.get('agent_id') not in agents:
            reasons.append({'code': 'unknown_agent', 'path': f'notes[{index}].agent_id', 'message': 'The note is for an agent the definition does not have.'})
        if limits.text_merges(str(note.get('text') or '')):
            reasons.append({'code': 'add_merge', 'path': f'notes[{index}].text', 'message': 'The note adds a merge. The Forja never merges.'})
    return reasons


def _is_code(proposal: ImprovementProposal) -> bool:
    return any(isinstance(change, dict) and change.get('path') == '$code' for change in _loads(proposal.diff_json, []))


async def propose(db: AsyncSession, *, factory_id: str, before: dict, after: dict, actor: tuple[str, str | None],
                  justification: str, failure_ids: list[str] | None = None, analyst: str | None = None,
                  notes: list[dict] | None = None, code_patch: str | None = None) -> ImprovementProposal:
    notes = notes or []
    _refuse_secrets(justification, code_patch or '', notes, after if code_patch is None else {})
    if code_patch is None and hash_of(before) == hash_of(after):
        raise FactoryError('unchanged', 409, 'The proposal does not change the definition.')
    if code_patch is not None:
        reasons = [{'code': 'add_merge', 'path': '$code', 'message': 'The proposal adds a merge. The Forja never merges.'}] if limits.text_merges(code_patch) else []
        reasons += _note_reasons(before, notes)
        changes = [{'path': '$code', 'op': 'changed', 'before': None, 'after': code_patch[:20000]}]
    else:
        reasons = _definition_reasons(factory_id, before, after) + _note_reasons(after, notes)
        changes = [change.as_dict() for change in diff(before, after)]
    proposal = ImprovementProposal(
        factory_id=factory_id, status='rejected' if reasons else 'pending', analyst=analyst,
        before_hash=hash_of(before), after_hash=hash_of(after), before_json=json.dumps(before, sort_keys=True),
        after_json=json.dumps(after, sort_keys=True), diff_json=json.dumps(changes), justification=justification[:4000],
        estimated_tokens=_estimate(before, after), failure_ids_json=json.dumps(failure_ids or []),
        notes_json=json.dumps(notes), rejection_json=json.dumps(reasons) if reasons else None,
    )
    db.add(proposal)
    await db.flush()
    await _event(db, proposal, 'rejected_by_validator' if reasons else 'proposed', actor,
                 {'reasons': reasons, 'failure_ids': failure_ids or [], 'diff_count': len(changes)})
    await db.commit()
    return proposal


async def decide(db: AsyncSession, proposal_id: str, action: str, actor: tuple[str, str | None], note: str | None = None) -> ImprovementProposal:
    _human_only(actor, 'Approving, rejecting or sending a proposal back')
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
        await _still_valid(db, proposal, after, actor)
        percent = int(_settings(after)['canaryPercent'])
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


async def _still_valid(db: AsyncSession, proposal: ImprovementProposal, after: dict, actor: tuple[str, str | None]) -> None:
    """At the moment of approval the proposal must still start from the active version and still pass every limit."""
    current = await versions.state(db, proposal.factory_id)
    if current.stable is None or current.stable.hash != proposal.before_hash:
        proposal.status = 'stale'
        await _event(db, proposal, 'stale', actor, {'before_hash': proposal.before_hash, 'stable_hash': current.stable.hash if current.stable else None})
        await db.commit()
        raise FactoryError('stale', 409, 'The active definition changed since this proposal was made. Ask for a new one.')
    reasons = _definition_reasons(proposal.factory_id, json.loads(current.stable.definition_json), after)
    reasons += _note_reasons(after, _loads(proposal.notes_json, []))
    if reasons:
        proposal.status = 'rejected'
        proposal.rejection_json = json.dumps(reasons)
        await _event(db, proposal, 'rejected_by_validator', actor, {'reasons': reasons, 'at': 'decision'})
        await db.commit()
        raise FactoryError('rejected_by_validator', 409, 'The proposal no longer passes the limits.')


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
    _human_only(actor, 'Revoking a note')
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


async def _trial(db: AsyncSession, proposal: ImprovementProposal) -> None:
    """The proposal is a trial and its version is the canary that is running now."""
    current = await versions.state(db, proposal.factory_id)
    if proposal.status != 'canary' or current.canary is None or current.canary.hash != proposal.after_hash:
        raise FactoryError('not_canary', 409, 'Only a trial that is still running can be measured.')


async def measure(db: AsyncSession, proposal_id: str, actor: tuple[str, str | None], *, now: datetime | None = None) -> dict:
    _human_only(actor, 'Measuring a trial')
    proposal = await db.get(ImprovementProposal, proposal_id)
    if proposal is None:
        raise FactoryError('not_found', 404)
    await _trial(db, proposal)
    settings = _settings(json.loads(proposal.after_json))
    minimum = int(settings['minSampleRuns'])
    days = int(settings['sampleDays'])
    baseline = await _flags(db, proposal.factory_id, proposal.before_hash)
    trial = await _flags(db, proposal.factory_id, proposal.after_hash)
    moment = now or _now()
    started = proposal.decided_at or proposal.created_at
    aged = bool(trial) and moment - started >= timedelta(days=days)
    if len(trial) < minimum and not aged:  # nothing decided, nothing written: asking again does not grow the trail
        return {'verdict': None, 'reason': 'sample', 'trial': len(trial), 'minimum': minimum}
    result = compare(baseline, trial)
    base_low, base_high = wilson(sum(baseline), len(baseline))
    trial_low, trial_high = wilson(sum(trial), len(trial))
    summary = {'verdict': result, 'baseline': {'n': len(baseline), 'low': base_low, 'high': base_high},
               'trial': {'n': len(trial), 'low': trial_low, 'high': trial_high}}
    await _event(db, proposal, 'measured', actor, summary)
    proposal.verdict = result
    if result == 'worsened':
        await versions.abort(db, proposal.factory_id, actor[1] or 'human')
        proposal.status = 'rolled_back'
        await _event(db, proposal, 'rolled_back', actor, {'reason': 'worsened', 'hash': proposal.before_hash})
    await db.commit()
    return summary


async def revert(db: AsyncSession, proposal_id: str, actor: tuple[str, str | None]) -> ImprovementProposal:
    """A person undoes a trial or, once it was promoted, the version it became."""
    _human_only(actor, 'Reverting a proposal')
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
    """A person promotes a trial that measured as improved and is still the running canary."""
    _human_only(actor, 'Promoting a trial')
    proposal = await db.get(ImprovementProposal, proposal_id)
    if proposal is None or proposal.status != 'canary' or proposal.verdict != 'improved':
        raise FactoryError('not_ready', 409, 'Promote is offered only after the trial measured as improved.')
    try:
        await _trial(db, proposal)
    except FactoryError:
        raise FactoryError('not_ready', 409, 'The trial is no longer running, so there is nothing to promote.') from None
    await versions.promote(db, proposal.factory_id, actor[1] or 'human')
    proposal.status = 'promoted'
    await _event(db, proposal, 'promoted', actor, {'hash': proposal.after_hash})
    await db.commit()
    return proposal


async def record_score(db: AsyncSession, *, factory_id: str, version_hash: str, scorer_id: str, run_id: str, origin: str,
                       passed: bool | None = None, score: float | None = None, evidence: dict | None = None,
                       agent_id: str | None = None, stage: str | None = None, work_item_id: str | None = None,
                       cost_tokens: int = 0, interventions: int = 0, label: str | None = None) -> FactoryScore:
    """Append one result. A later call for the same run and scorer is the next attempt; the earlier rows stay."""
    if origin not in ('run_loop', 'human'):
        raise FactoryError('scorer_only', 403, 'A score comes from the run loop or from a person.')
    current = await versions.state(db, factory_id)
    known = {version.hash: version for version in (current.stable, current.canary) if version is not None}
    if version_hash not in known:
        raise FactoryError('unknown_version', 409, 'A score names the active version or the running trial.')
    if work_item_id is not None:
        item = await db.get(WorkItem, work_item_id)
        if item is None or item.factory_id != factory_id or item.factory_version != version_hash:
            raise FactoryError('version_mismatch', 409, 'That work item did not run on this version.')
    definition = json.loads(known[version_hash].definition_json)
    declared = (definition.get('scorers') or {}).get(scorer_id)
    if not isinstance(declared, dict):
        raise FactoryError('unknown_scorer', 404, 'That scorer is not in the definition.')
    scorer = {**rules.SCORER_DEFAULTS, **declared}
    if scorer['enabled'] is not True:
        raise FactoryError('scorer_off', 409, 'That scorer is turned off.')
    passing = float(scorer['passingScore'])
    kind, reason = scorer.get('kind', 'deterministic'), ''
    evidence = dict(evidence or {})
    if kind == 'classification':
        if label is None or passed is not None or score is not None:
            raise FactoryError('missing_label', 422, 'A classification scorer takes one of its labels and nothing else.')
        try:
            passed, score, reason = classify(label, scorer.get('labels') or [], passing)
        except ValueError:
            raise FactoryError('unknown_label', 422, 'That classification is not one this scorer declares.') from None
    elif label is not None:
        raise FactoryError('unknown_label', 422, 'This scorer does not classify.')
    elif passed is None:
        check = scorer.get('check')
        if not check:
            raise FactoryError('missing_fields', 422, 'A score needs a result or a check.')
        policy = {**rules.POLICY_DEFAULTS, **(definition.get('policy') or {})}
        evidence['cap'] = policy['maxReviewReturns']  # the lines come from the definition, never from the evidence
        envelope = (definition.get('ceilings') or {}).get('tokensPerWorkItem')
        evidence.pop('envelope', None)
        if envelope is not None:
            evidence['envelope'] = envelope
        try:
            passed, score, reason = evaluate(check, evidence)
        except ValueError:
            raise FactoryError('unknown_check', 422, 'That check is not one the Forja runs.') from None
    score = (1.0 if passed else 0.0) if score is None else float(score)
    if score < passing:
        passed = False
    previous = await db.scalar(select(func.max(FactoryScore.attempt)).where(
        FactoryScore.factory_id == factory_id, FactoryScore.scorer_id == scorer_id, FactoryScore.run_id == run_id))
    attempt = (previous or 0) + 1
    row = FactoryScore(factory_id=factory_id, version_hash=version_hash, scorer_id=scorer_id, run_id=run_id, attempt=attempt,
                       origin=origin, work_item_id=work_item_id, agent_id=agent_id, stage=stage, passed=bool(passed), score=score,
                       cost_tokens=cost_tokens, interventions=interventions, reason=reason)
    db.add(row)
    await db.flush()
    if not passed:
        db.add(FactoryFailure(factory_id=factory_id, agent_id=agent_id, stage=stage, kind=kind, scorer_id=scorer_id,
                              run_id=run_id, attempt=attempt, work_item_id=work_item_id, score=score, passing_score=passing,
                              reason=reason or 'below the pass line',
                              evidence_json=json.dumps(evidence, sort_keys=True)[:EVIDENCE_MAX_BYTES]))
    await db.commit()
    return row


async def _flags(db: AsyncSession, factory_id: str, version_hash: str) -> list[bool]:
    """The current result of each run: its latest attempt per scorer."""
    rows = await db.scalars(select(FactoryScore).where(FactoryScore.factory_id == factory_id, FactoryScore.version_hash == version_hash)
                            .order_by(FactoryScore.attempt))
    latest: dict[tuple[str, str], bool] = {}
    for row in rows:
        latest[(row.scorer_id, row.run_id)] = row.passed
    return list(latest.values())


async def superseded(db: AsyncSession, rows: list[FactoryFailure]) -> set[str]:
    """Failures a later attempt of the same run and scorer replaced. They stay in the book, marked."""
    runs = {row.run_id for row in rows if row.run_id}
    if not runs:
        return set()
    latest = {(factory, scorer, run): attempt for factory, scorer, run, attempt in (await db.execute(
        select(FactoryScore.factory_id, FactoryScore.scorer_id, FactoryScore.run_id, func.max(FactoryScore.attempt))
        .where(FactoryScore.run_id.in_(runs)).group_by(FactoryScore.factory_id, FactoryScore.scorer_id, FactoryScore.run_id))).all()}
    return {row.id for row in rows if latest.get((row.factory_id, row.scorer_id, row.run_id), row.attempt) > row.attempt}


async def _events(db: AsyncSession, proposal_id: str) -> list[ImprovementEvent]:
    return list(await db.scalars(select(ImprovementEvent).where(ImprovementEvent.proposal_id == proposal_id).order_by(ImprovementEvent.id)))


async def run_check(db: AsyncSession, factory_id: str, actor: tuple[str, str | None], *, force: bool = False) -> dict:
    """Start a proposal when enough failures are still open, or when a person asks to run it now."""
    _human_only(actor, 'Starting an improvement check')
    current = await versions.state(db, factory_id)
    if current.stable is None:
        raise FactoryError('no_stable', 409, 'There is no active definition to improve.')
    before = json.loads(current.stable.definition_json)
    settings = _settings(before)
    threshold, age_days = int(settings['failureThreshold']), int(settings['ageDays'])
    linked: set[str] = set()
    for proposal in await proposals(db, factory_id):
        if proposal.status != 'rejected':
            linked.update(_loads(proposal.failure_ids_json, []))
    found = await failures(db, factory_id)
    replaced = await superseded(db, found)
    open_rows = [row for row in found if row.id not in linked and row.id not in replaced]
    oldest = min((row.at for row in open_rows), default=None)
    if not schedule_due(len(open_rows), oldest, _now(), threshold=threshold, age_days=age_days, force=force):
        return {'started': False, 'reason': 'threshold', 'open': len(open_rows)}
    after = draft_after(before, [{'agent_id': row.agent_id, 'reason': row.reason} for row in open_rows])
    proposal = await propose(db, factory_id=factory_id, before=before, after=after, actor=actor,
                             justification='Open failures for the same agent.', failure_ids=[row.id for row in open_rows],
                             analyst=settings.get('analyst'))
    return {'started': proposal.status == 'pending', 'reason': None if proposal.status == 'pending' else 'rejected', 'proposal': proposal_json(proposal)}


async def proposals(db: AsyncSession, factory_id: str | None = None, *, limit: int | None = None) -> list[ImprovementProposal]:
    query = select(ImprovementProposal).order_by(ImprovementProposal.created_at.desc())
    if factory_id:
        query = query.where(ImprovementProposal.factory_id == factory_id)
    if limit is not None:
        query = query.limit(limit)
    return list(await db.scalars(query))


async def failures(db: AsyncSession, factory_id: str | None = None) -> list[FactoryFailure]:
    query = select(FactoryFailure).order_by(FactoryFailure.at.desc()).limit(200)
    if factory_id:
        query = query.where(FactoryFailure.factory_id == factory_id)
    return list(await db.scalars(query))


async def export_events(db: AsyncSession, factory_id: str | None = None, *, after_id: int | None = None, limit: int = 500) -> dict:
    """One page of the trail, oldest first. `next` is the id to pass as `after_id` for the following page, or None at the end."""
    query = select(ImprovementEvent).order_by(ImprovementEvent.id)
    if factory_id:
        query = query.where(ImprovementEvent.factory_id == factory_id)
    if after_id is not None:
        query = query.where(ImprovementEvent.id > after_id)
    rows = list(await db.scalars(query.limit(limit + 1)))
    more = len(rows) > limit
    rows = rows[:limit]
    return {'events': [_event_json(row) for row in rows], 'next': rows[-1].id if more and rows else None}


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


def failure_json(row: FactoryFailure, replaced: bool = False) -> dict:
    return {
        'id': row.id, 'factory_id': row.factory_id, 'agent_id': row.agent_id, 'stage': row.stage, 'kind': row.kind,
        'scorer_id': row.scorer_id, 'run_id': row.run_id, 'work_item_id': row.work_item_id, 'score': row.score,
        'passing_score': row.passing_score, 'reason': row.reason, 'attempt': row.attempt, 'superseded': replaced, 'at': _iso(row.at),
    }


def _event_json(row: ImprovementEvent) -> dict:
    return {
        'id': row.id, 'proposal_id': row.proposal_id, 'factory_id': row.factory_id, 'type': row.type,
        'actor': {'kind': row.actor_kind, 'id': row.actor_id}, 'data': _loads(row.data_json, {}), 'at': _iso(row.at),
    }
