"""A complete, valid Forja definition for the self-improvement tests, plus the credentials they present."""
from __future__ import annotations

import copy

FACTORY = 'improve'
HUMAN = {'x-oharness-human': 'human-secret'}
MEMORY = {'maxNotes': 50, 'maxNoteChars': 400, 'maxTotalBytes': 20480}


def agent(role: str, model: str, mode: str, instructions: str) -> dict:
    return {'role': role, 'model': model, 'instructions': instructions, 'skills': [], 'localSkills': {}, 'mcp': [],
            'permissions': {'mode': mode}, 'secrets': [], 'memory': dict(MEMORY), 'enabled': True}


def definition(instructions: str = 'Build the change.', name: str = FACTORY) -> dict:
    return copy.deepcopy({
        'kind': 'forja', 'schemaVersion': '1.0.0', 'name': name, 'alias': name,
        'defaults': {'model': 'openai/gpt-4o'},
        'repositories': [{'id': 'app', 'path': '.', 'protectedBranches': ['main']}],
        'tiers': {}, 'ceilings': {'tokensPerWorkItem': 500000, 'tokensPerRun': 100000},
        'policy': {'requireSpec': True, 'specApproval': 'required', 'maxReviewReturns': 3, 'reviewIndependence': 'require',
                   'maxPermissionMode': 'workspace_write'},
        'stages': {'review': {'enabled': True, 'required': True}, 'verify': {'enabled': True, 'required': True},
                   'spec': {'enabled': True, 'required': True}},
        'runners': {},
        'agents': {
            'foreman': agent('foreman', 'openai/gpt-4o', 'read_only', 'Coordinate.'),
            'writer': agent('spec', 'openai/gpt-4o', 'read_only', 'Write the spec.'),
            'builder': agent('implement', 'openai/gpt-4o', 'workspace_write', instructions),
            'reviewer': agent('review', 'anthropic/claude', 'read_only', 'Review.'),
            'verifier': agent('verify', 'openai/gpt-4o', 'read_only', 'Check.'),
        },
        'skills': {}, 'mcp': {}, 'reserved': {'automations': {}, 'webhooks': {}},
        'scorers': {
            'qa': {'kind': 'deterministic', 'enabled': True, 'passingScore': 1, 'selfImprovement': True, 'check': 'qa_rejected'},
            'tests': {'kind': 'classification', 'enabled': True, 'passingScore': 1, 'selfImprovement': True,
                      'labels': [{'value': 'tests-run', 'score': 1}, {'value': 'tests-partial', 'score': 0.5},
                                 {'value': 'tests-skipped', 'score': 0}]},
        },
        'selfImprovement': {'analyst': 'foreman', 'failureThreshold': 25, 'ageDays': 7, 'minSampleRuns': 20, 'sampleDays': 7,
                            'canaryPercent': 10},
    })
