"""Metrics of the Forja (ADR 0058): read from the work items and their events, never stored, so there is no second state to drift.

What the data cannot say is reported as unavailable with the reason, never invented. Figures carry counts and durations only: no titles,
branch names or people. Every figure can be split by definition version, to compare a canary with the stable one.
"""
from __future__ import annotations

import statistics
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from factory.orm import WorkItem, WorkItemArtifact, WorkItemEvent, WorkItemRun
from factory.service import FactoryError

SCHEMA_VERSION = 1
WINDOWS = {'7d': 7, '30d': 30, '90d': 90}
MAX_RANGE = timedelta(days=366)
MAX_ITEMS = 5000
SIZE_CUTS = (('S', 100), ('M', 500), ('L', 1000))  # changed lines: below 100 is S, below 500 M, below 1000 L, the rest XL
# Human events that mean the Forja needed help; the decisions a person is meant to take (approve the spec, confirm the merge) do not count.
INTERVENTIONS = ('changes_requested', 'spec_edited', 'advanced', 'note')


def _median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def _size(label: str) -> str:
    for part in (label or '').split():
        if part.startswith('lines=') and part[6:].isdigit():
            lines = int(part[6:])
            return next((name for name, cut in SIZE_CUTS if lines < cut), 'XL')
    return 'unknown'


def _moment(text: str) -> datetime:
    """A date or a date-time; a zone is converted to UTC and dropped, because the Forja stores UTC without a zone."""
    parsed = datetime.fromisoformat(text)
    return parsed.astimezone(timezone.utc).replace(tzinfo=None) if parsed.tzinfo else parsed


def resolve_range(window: str | None, since: str | None, until: str | None, now: datetime) -> tuple[str, datetime, datetime]:
    if since or until:
        try:
            start = _moment(since) if since else now - timedelta(days=30)
            end = (_moment(until) + timedelta(days=1) if until and len(until) <= 10 else _moment(until)) if until else now
        except (ValueError, OverflowError):
            raise FactoryError('invalid_range', 422, 'since and until are dates like 2026-11-01.') from None
        if end <= start or end - start > MAX_RANGE:
            raise FactoryError('invalid_range', 422, 'The range must be positive and at most one year.')
        return 'custom', start, end
    if window not in WINDOWS:
        raise FactoryError('invalid_window', 422, 'window is 7d, 30d or 90d.')
    return window, now - timedelta(days=WINDOWS[window]), now


def _core(items: list[WorkItem], events: dict[str, list[WorkItemEvent]], artifacts: dict[str, list[WorkItemArtifact]], runs: dict[str, list[WorkItemRun]],
          start: datetime, end: datetime) -> dict:
    def inside(moment: datetime) -> bool:
        return start <= moment < end

    def first(item_id: str, *types: str) -> WorkItemEvent | None:
        return next((e for e in events[item_id] if e.type in types), None)

    opened_items, merged_items, completed = set(), set(), 0
    prs_opened = prs_merged = 0
    shares: list[float] = []
    by_size: dict[str, dict] = {}
    touched = []
    to_pr, to_review, to_merge, lifetime = [], [], [], []
    first_pass, returns, reviewed, verify_failures, interventions, after_verify = [], [], 0, 0, 0, 0
    for item in items:
        evs, arts = events[item.id], artifacts[item.id]
        if inside(item.created_at) or any(inside(e.at) for e in evs):
            touched.append(item)
        in_window = [a for a in arts if inside(a.created_at)]
        merge = next((e for e in evs if e.type == 'merge_observed' and e.at < end), None)
        if in_window:
            opened_items.add(item.id)
            prs_opened += len(in_window)
            for art in in_window:
                share = item.cost_tokens / len(arts)
                shares.append(share)
                size = by_size.setdefault(_size(art.label), {'prs': 0, 'median_tokens': []})
                size['prs'] += 1
                size['median_tokens'].append(share)
        if merge is not None and in_window:
            merged_items.add(item.id)
            prs_merged += len(in_window)
        done = next((e for e in evs if e.type == 'completed' and inside(e.at)), None)
        if done is not None:
            completed += 1
            lifetime.append((done.at - item.created_at).total_seconds())
        run = first(item.id, 'run_linked')
        if run is not None and inside(run.at):
            pr = first(item.id, 'artifact_added')
            verdict = first(item.id, 'review_verdict')
            if pr is not None:
                to_pr.append((pr.at - run.at).total_seconds())
            if verdict is not None:
                to_review.append((verdict.at - run.at).total_seconds())
            merged = first(item.id, 'merge_observed')
            if merged is not None:
                to_merge.append((merged.at - run.at).total_seconds())
        all_verdicts = [e for e in evs if e.type == 'review_verdict']
        verdicts = [e for e in all_verdicts if inside(e.at)]
        if verdicts:
            reviewed += 1
            if inside(all_verdicts[0].at):  # the first review of the item decides, and only when it happened in the window
                first_pass.append(1.0 if json_verdict(all_verdicts[0]) == 'approved' else 0.0)
            verify_seen = next((e.sequence for e in evs if e.type == 'stage_entered' and json_stage(e) == 'verify'), None)
            if verify_seen is not None and any(json_verdict(v) == 'changes_requested' and v.sequence > verify_seen for v in verdicts):
                after_verify += 1
            returns.append(sum(1 for e in evs if e.type == 'returned_to_implement' and inside(e.at)))
        verify_failures += sum(1 for e in evs if e.type == 'verify_failed' and inside(e.at))
        interventions += sum(1 for e in evs if inside(e.at) and e.actor_kind == 'human' and (e.type in INTERVENTIONS or (e.type == 'checkpoint_resolved' and json_kind(e) == 'question')))
    stage_runs: dict[str, int] = {}
    for item in touched:
        for run in runs[item.id]:
            stage_runs[run.stage] = stage_runs.get(run.stage, 0) + 1
    return {
        'throughput': {'prs_opened': prs_opened, 'prs_merged': prs_merged, 'items_opened': len(opened_items), 'items_merged': len(merged_items), 'items_completed': completed},
        'cost': {
            'basis': 'lifetime tokens of the items touched in the window', 'total_tokens': sum(i.cost_tokens for i in touched), 'median_tokens_per_pr': _median(shares),
            'tokens_by_stage': {'available': False, 'runs': dict(sorted(stage_runs.items()))},
            'by_size': {name: {'prs': v['prs'], 'median_tokens': _median(v['median_tokens'])} for name, v in sorted(by_size.items())},
        },
        'quality': {'items_reviewed': reviewed, 'approved_first_review': statistics.mean(first_pass) if first_pass else None,
                    'avg_returns_to_implement': statistics.mean(returns) if returns else None, 'verify_failures': verify_failures, 'changes_requested_after_verify': after_verify},
        'autonomy': {'merged_without_human_push': {'available': False, 'reason': 'needs the commit authors of the branch, which the Forja does not keep'},
                     'human_interventions_per_item': interventions / len(touched) if touched else None},
        'cycle_time': {'run_to_pr_median_s': _median(to_pr), 'run_to_first_review_median_s': _median(to_review), 'run_to_merge_median_s': _median(to_merge),
                       'created_to_done_median_s': _median(lifetime), 'created_to_done_p90_s': _percentile(lifetime, 0.9)},
    }


def json_verdict(event: WorkItemEvent) -> str:
    import json
    return json.loads(event.data_json).get('verdict', '')


def json_stage(event: WorkItemEvent) -> str:
    import json
    return json.loads(event.data_json).get('stage', '')


def json_kind(event: WorkItemEvent) -> str:
    import json
    return json.loads(event.data_json).get('kind', '')


def _percentile(values: list[float], share: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(share * len(ordered)))]


async def compute(db: AsyncSession, *, window: str | None = '7d', since: str | None = None, until: str | None = None, factory_id: str | None = None,
                  factory_version: str | None = None) -> dict:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    label, start, end = resolve_range(window, since, until, now)
    # An item untouched since the start has no event in the range; the load is bounded too.
    query = select(WorkItem).where(WorkItem.created_at < end, WorkItem.updated_at >= start).order_by(WorkItem.created_at.desc()).limit(MAX_ITEMS)
    if factory_id:
        query = query.where(WorkItem.factory_id == factory_id)
    if factory_version:
        query = query.where(WorkItem.factory_version == factory_version)
    items = list(await db.scalars(query))
    ids = [i.id for i in items]
    events: dict[str, list[WorkItemEvent]] = {i: [] for i in ids}
    artifacts: dict[str, list[WorkItemArtifact]] = {i: [] for i in ids}
    runs: dict[str, list[WorkItemRun]] = {i: [] for i in ids}
    if ids:
        for event in await db.scalars(select(WorkItemEvent).where(WorkItemEvent.work_item_id.in_(ids)).order_by(WorkItemEvent.work_item_id, WorkItemEvent.sequence)):
            events[event.work_item_id].append(event)
        for art in await db.scalars(select(WorkItemArtifact).where(WorkItemArtifact.work_item_id.in_(ids), WorkItemArtifact.kind.in_(('pr', 'diff')))
                                    .order_by(WorkItemArtifact.created_at)):
            artifacts[art.work_item_id].append(art)
        for run in await db.scalars(select(WorkItemRun).where(WorkItemRun.work_item_id.in_(ids))):
            runs[run.work_item_id].append(run)
    out = {'schemaVersion': SCHEMA_VERSION, 'window': label, 'since': start.isoformat() + 'Z', 'until': end.isoformat() + 'Z',
           **_core(items, events, artifacts, runs, start, end)}
    versions = sorted({i.factory_version for i in items if i.factory_version})
    out['by_version'] = {v: _core([i for i in items if i.factory_version == v], events, artifacts, runs, start, end) for v in versions}
    return out
