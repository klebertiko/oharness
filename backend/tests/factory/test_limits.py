"""A proposal that would loosen a gate, a mode, a scorer or the network is refused before a person sees it."""
from __future__ import annotations

import copy

from datetime import datetime, timedelta

from factory.improvement import benchmarks, limits
from factory.improvement.service import classify, compare, sampled, schedule_due


def _definition() -> dict:
    return {
        'name': 'improve',
        'policy': {
            'requireSpec': True, 'specApproval': 'required', 'maxReviewReturns': 3,
            'reviewIndependence': 'require', 'maxPermissionMode': 'workspace_write',
        },
        'stages': {
            'review': {'enabled': True, 'required': True},
            'verify': {'enabled': True, 'required': True},
            'spec': {'enabled': True, 'required': True},
        },
        'agents': {
            'foreman': {'role': 'foreman', 'enabled': True, 'permissions': {'mode': 'read_only'}, 'secrets': [], 'instructions': 'Coordinate.'},
            'builder': {'role': 'implement', 'enabled': True, 'permissions': {'mode': 'workspace_write'}, 'secrets': [], 'instructions': 'Build.',
                        'networkPolicy': {'allowedHosts': ['api.example.com'], 'deniedHosts': ['blocked.example.com']}},
            'reviewer': {'role': 'review', 'enabled': True, 'permissions': {'mode': 'read_only'}, 'secrets': [], 'instructions': 'Review.'},
            'verifier': {'role': 'verify', 'enabled': True, 'permissions': {'mode': 'read_only'}, 'secrets': [], 'instructions': 'Check.'},
        },
        'scorers': {'qa': {'kind': 'deterministic', 'enabled': True, 'passingScore': 0.8, 'selfImprovement': True, 'check': 'qa_rejected'}},
        'networkPolicy': {'allowedHosts': ['api.example.com'], 'deniedHosts': ['blocked.example.com']},
    }


def _codes(after: dict) -> set[str]:
    return {reason['code'] for reason in limits.check(_definition(), after)}


def test_a_proposal_that_only_edits_instructions_is_allowed():
    after = _definition()
    after['agents']['builder']['instructions'] = 'Build it, and ask when a check already failed.'
    assert limits.check(_definition(), after) == []


def test_removing_a_gate_is_rejected_with_a_reason():
    after = _definition()
    after['stages']['review'] = {'enabled': False, 'required': False}
    after['stages']['verify'] = {'enabled': False, 'required': False}
    reasons = limits.check(_definition(), after)
    assert 'weaken_gate' in {reason['code'] for reason in reasons}
    assert any('review' in reason['path'] for reason in reasons)


def test_raising_the_permission_mode_is_rejected():
    after = _definition()
    after['policy']['maxPermissionMode'] = 'full'
    assert 'raise_permission' in _codes(after)


def test_adding_a_merge_is_rejected():
    after = _definition()
    after['merge'] = True
    assert 'add_merge' in _codes(after)
    text = _definition()
    text['agents']['builder']['instructions'] = 'action: merge\n'
    assert 'add_merge' in _codes(text)


def test_lowering_a_scorer_or_turning_it_off_is_rejected():
    lowered = _definition()
    lowered['scorers']['qa']['passingScore'] = 0.2
    assert 'lower_threshold' in _codes(lowered)
    disabled = _definition()
    disabled['scorers']['qa']['enabled'] = False
    assert 'disable_scorer' in _codes(disabled)


def test_widening_the_network_or_adding_a_secret_is_rejected():
    wider = _definition()
    wider['networkPolicy']['allowedHosts'] = ['api.example.com', 'extra.example.com']
    assert 'widen_network' in _codes(wider)
    secrets = _definition()
    secrets['agents']['builder']['secrets'] = ['forja/npm']
    assert 'add_secret' in _codes(secrets)


def test_skipping_the_person_is_rejected():
    after = _definition()
    after['selfImprovement'] = {'reviewerType': 'none'}
    assert 'skip_human' in _codes(after)


def test_a_clearly_worse_pass_rate_is_worsened_and_a_better_one_is_improved():
    assert compare([True] * 20, [True] * 5 + [False] * 15) == 'worsened'
    assert compare([True] * 5 + [False] * 15, [True] * 20) == 'improved'
    assert compare([True] * 20, [True] * 20) == 'tied'
    assert compare([], [False]) == 'tied'


def test_sampling_classification_and_the_failure_schedule():
    hits = [sampled(f'run-{i}', 'qa', 10) for i in range(1000)]
    assert 70 <= sum(hits) <= 130
    assert sampled('run-1', 'qa', 10) is sampled('run-1', 'qa', 10)
    assert sampled('run-1', 'qa', 0) is False and sampled('run-1', 'qa', 100) is True
    labels = [{'value': 'tests_run', 'score': 1}, {'value': 'tests_skipped', 'score': 0}]
    assert classify('tests_run', labels, 1) == (True, 1.0, 'tests_run')
    assert classify('tests_skipped', labels, 1)[0] is False
    now = datetime(2026, 11, 21)
    assert schedule_due(24, now, now) is False
    assert schedule_due(25, now, now) is True
    assert schedule_due(1, now - timedelta(days=7), now) is True
    assert schedule_due(1, now, now, force=True) is True
    assert schedule_due(0, None, now, force=True) is False


def test_a_benchmark_freezes_its_inputs_and_names_three_configurations():
    source = {'id': 'run-9', 'prompt': 'Fix the login.'}
    task = benchmarks.freeze_task(source, 'The login works.')
    source['prompt'] = 'changed later'
    assert task['inputs']['prompt'] == 'Fix the login.' and task['prompt'] == 'Fix the login.'
    trials = [
        {'name': 'deep', 'quality': 0.95, 'cost': 100, 'seconds': 100},
        {'name': 'fast', 'quality': 0.80, 'cost': 30, 'seconds': 10},
        {'name': 'tiny', 'quality': 0.50, 'cost': 5, 'seconds': 50},
    ]
    assert benchmarks.recommend(trials) == {'overall': 'deep', 'efficient': 'fast', 'cheapest': 'tiny'}
    assert benchmarks.trial_count(2, 3, 2) == 12


def test_a_copied_definition_is_not_mutated_by_the_check():
    before = _definition()
    snapshot = copy.deepcopy(before)
    limits.check(before, _definition())
    assert before == snapshot
