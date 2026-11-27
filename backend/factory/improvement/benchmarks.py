"""Benchmark results from trials that were already run.

The inputs of a task are copied when it is taken from a run, so a later edit of that run
does not change the task. Recommendations name three configurations. Applying one is a
proposal: a person still has to approve it, and approval starts a canary.
"""
from __future__ import annotations

import copy


def freeze_task(source: dict, criteria: str) -> dict:
    prompt = str(source.get('prompt') or source.get('summary') or '')
    return {
        'source_run_id': source.get('id'),
        'prompt': prompt,
        'successCriteria': criteria,
        'inputs': {'prompt': prompt, 'source_run_id': source.get('id')},
    }


def trial_count(configurations: int, tasks: int, repeats: int) -> int:
    if min(configurations, tasks, repeats) < 1:
        raise ValueError('a launch needs at least one configuration, task and repetition')
    return configurations * tasks * repeats


def recommend(trials: list[dict]) -> dict:
    """`overall` is the highest quality, `cheapest` the lowest cost, `efficient` the best quality per second."""
    if len(trials) < 2:
        raise ValueError('a recommendation needs two configurations')
    overall = min(trials, key=lambda trial: (-float(trial['quality']), float(trial['cost'])))
    cheapest = min(trials, key=lambda trial: (float(trial['cost']), -float(trial['quality'])))
    efficient = max(trials, key=lambda trial: float(trial['quality']) / max(float(trial['seconds']), 1e-9))
    return {'overall': overall['name'], 'efficient': efficient['name'], 'cheapest': cheapest['name']}


def apply_model(definition: dict, agent: str, model: str) -> dict:
    """One configuration change: the named agent's model. Nothing else moves."""
    after = copy.deepcopy(definition)
    after['agents'][agent]['model'] = model
    return after
