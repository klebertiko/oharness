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
    assert 'protected_field' in _codes(after)  # no such field: an unknown field in a protected section is refused


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


# ------------------------------------------------------------------------------------------------- fail closed: nothing loosens by omission

def test_removing_a_policy_key_is_refused_even_when_the_default_is_looser():
    for key in ('maxPermissionMode', 'maxReviewReturns', 'reviewIndependence', 'specApproval', 'requireSpec'):
        after = _definition()
        del after['policy'][key]
        assert 'remove_field' in _codes(after), key


def test_a_looser_policy_compared_to_a_missing_one_uses_the_effective_default():
    before = _definition()
    del before['policy']['maxReviewReturns']  # the effective value is the default, 3
    after = copy.deepcopy(before)
    after['policy']['maxReviewReturns'] = 9
    assert 'weaken_gate' in {reason['code'] for reason in limits.check(before, after)}


def test_a_value_of_the_wrong_type_is_refused():
    after = _definition()
    after['policy']['maxReviewReturns'] = '1'
    assert 'invalid_type' in _codes(after)
    after = _definition()
    after['scorers']['qa']['passingScore'] = 'high'
    assert 'invalid_type' in _codes(after)


def test_removing_the_pass_line_is_refused():
    after = _definition()
    del after['scorers']['qa']['passingScore']
    assert 'remove_field' in _codes(after)


def test_a_new_agent_is_held_to_the_active_ceiling():
    after = _definition()
    after['agents']['helper'] = {'role': 'custom', 'enabled': True, 'permissions': {'mode': 'full'}, 'secrets': [], 'instructions': 'Help.'}
    assert 'raise_permission' in _codes(after)
    after = _definition()
    after['agents']['helper'] = {'role': 'custom', 'enabled': True, 'permissions': {'mode': 'read_only'}, 'secrets': [], 'instructions': 'Help.',
                                 'networkPolicy': {'allowedHosts': ['evil.example.net']}}
    assert 'widen_network' in _codes(after)


def test_an_agent_mode_left_implicit_is_the_default_not_a_pass():
    before = _definition()
    before['agents']['reviewer']['permissions'] = {}
    after = copy.deepcopy(before)
    after['agents']['reviewer']['permissions'] = {'mode': 'full'}
    assert 'raise_permission' in {reason['code'] for reason in limits.check(before, after)}


def test_sampling_and_trial_settings_cannot_loosen():
    cases = {
        'samplingRate': lambda d: d['scorers']['qa'].update(samplingRate=0),
        'canaryPercent': lambda d: d['selfImprovement'].update(canaryPercent=50),
        'minSampleRuns': lambda d: d['selfImprovement'].update(minSampleRuns=1),
        'failureThreshold': lambda d: d['selfImprovement'].update(failureThreshold=50),
        'sampleDays': lambda d: d['selfImprovement'].update(sampleDays=1),
        'ageDays': lambda d: d['selfImprovement'].update(ageDays=90),
    }
    for name, change in cases.items():
        before = _definition()
        before['selfImprovement'] = {'failureThreshold': 25, 'ageDays': 7, 'minSampleRuns': 20, 'sampleDays': 7, 'canaryPercent': 10}
        after = copy.deepcopy(before)
        change(after)
        assert 'loosen_trial' in {reason['code'] for reason in limits.check(before, after)}, name
    before = _definition()
    after = copy.deepcopy(before)
    after['selfImprovement'] = {'canaryPercent': 50}  # nothing declared before: the default (10) is the line
    assert 'loosen_trial' in {reason['code'] for reason in limits.check(before, after)}


def test_tightening_trial_settings_is_allowed():
    before = _definition()
    after = copy.deepcopy(before)
    after['selfImprovement'] = {'canaryPercent': 5, 'minSampleRuns': 40}
    after['scorers']['qa']['passingScore'] = 0.9
    assert limits.check(before, after) == []


def test_fields_outside_the_safe_list_are_protected():
    cases = {
        'runners': lambda d: d.update(runners={'local': {'type': 'local', 'maxConcurrentRuns': 8, 'credentialStrategy': 'user'}}),
        'repositories': lambda d: d.update(repositories=[{'id': 'app', 'path': '.', 'protectedBranches': ['release']}]),
        'mcp': lambda d: d.update(mcp={'shell': {'command': 'bash'}}),
        'reserved': lambda d: d.update(reserved={'automations': {'nightly': 'run'}, 'webhooks': {}}),
        'analyst': lambda d: d.update(selfImprovement={'analyst': 'builder'}),
        'agent_mcp': lambda d: d['agents']['builder'].update(mcp=['shell']),
        'agent_trigger': lambda d: d['agents']['builder'].update(trigger='nightly'),
        'labels': lambda d: d['scorers']['qa'].update(labels=[{'value': 'bad', 'score': 1}]),
    }
    for name, change in cases.items():
        after = _definition()
        change(after)
        assert 'protected_field' in _codes(after), name


def test_ceilings_cannot_go_up_or_away():
    before = _definition()
    before['ceilings'] = {'tokensPerWorkItem': 1000, 'tokensPerRun': 500}
    for change in ({'tokensPerWorkItem': 2000, 'tokensPerRun': 500}, {'tokensPerRun': 500}):
        after = copy.deepcopy(before)
        after['ceilings'] = change
        assert 'raise_ceiling' in {reason['code'] for reason in limits.check(before, after)}, change


def test_every_configurable_stage_is_a_gate():
    before = _definition()
    before['stages']['monitor'] = {'enabled': True}
    after = copy.deepcopy(before)
    after['stages']['monitor'] = {'enabled': False}
    assert 'weaken_gate' in {reason['code'] for reason in limits.check(before, after)}


def test_requiring_and_turning_on_are_judged_one_at_a_time():
    unrequired = _definition()
    unrequired['stages']['review'] = {'enabled': True, 'required': False}
    assert 'weaken_gate' in _codes(unrequired)
    off = _definition()
    off['stages']['verify'] = {'enabled': False, 'required': True}
    assert 'weaken_gate' in _codes(off)


def test_removing_or_turning_off_the_reviewer_weakens_the_gate_even_with_explicit_stages():
    removed = _definition()
    del removed['agents']['reviewer']
    assert 'weaken_gate' in _codes(removed)
    disabled = _definition()
    disabled['agents']['reviewer']['enabled'] = False
    assert 'weaken_gate' in _codes(disabled)


def test_an_engine_is_a_protected_field_of_an_agent():
    changed = _definition()
    changed['agents']['reviewer']['engine'] = 'review-flow'
    assert 'protected_field' in _codes(changed)
    added = _definition()
    added['agents']['helper'] = {'role': 'custom', 'enabled': True, 'permissions': {'mode': 'read_only'}, 'secrets': [], 'instructions': 'Help.',
                                 'engine': 'helper-flow'}
    assert 'protected_field' in _codes(added)


def test_a_string_where_a_flag_belongs_is_refused():
    after = _definition()
    after['scorers']['qa']['enabled'] = 'false'
    assert 'invalid_type' in _codes(after)


def test_a_long_earlier_text_does_not_hide_a_new_merge():
    before = _definition()
    before['agents']['builder']['instructions'] = 'x' * 150_000
    after = copy.deepcopy(before)
    after['agents']['builder']['instructions'] = 'x' * 150_000 + '\ngit -C . merge main'
    assert 'add_merge' in {reason['code'] for reason in limits.check(before, after)}
