"""The one table of rules for the Forja definition (ADR 0056, 0067). The JSON Schema and the validator are built from it, so a rule
exists in one place only; the control room (#261) mirrors it for the UI with a parity test.

The schema has no field that can hold a credential: every object is closed (`additionalProperties: false`) and the only places that
accept a secret reference are `secretRef`, `pushSecretRef` and the items of `secrets[]`, all of them `forja/<name>`.
"""
from __future__ import annotations

import json
from pathlib import Path

KIND = 'forja'  # the `kind` of the root file; the other files declare theirs (ADR 0067, the OHM model of ADR 0003)
SCHEMA_VERSION = '1.0.0'
FILE_KINDS = {'agent': 'agent', 'mcp': 'mcp', 'runner': 'runner'}
SCHEMA_ID = 'https://oharness.dev/schema/forja-definition.schema.json'
SCHEMA_PATH = Path(__file__).resolve().parent.parent / 'oharness' / 'schema' / 'forja-definition.schema.json'
PERMISSION_MODES_PATH = Path(__file__).resolve().parent.parent / 'sandbox' / 'permission_modes.json'

MAX_FILE_BYTES = 256 * 1024
MAX_TOTAL_BYTES = 4 * 1024 * 1024
MAX_FOLDERS = 300
MAX_TREE_DEPTH = 8
MAX_YAML_DEPTH = 40
ID_PATTERN = r'^[a-z0-9][a-z0-9-]{0,62}$'
SECRET_REF_PATTERN = r'^forja/[A-Za-z0-9_.-]{1,100}$'
MODEL_PATTERN = r'^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,99}$'
BRANCH_PATTERN = r'^[A-Za-z0-9][A-Za-z0-9._/*-]{0,199}$'
# A path inside the repository: relative, forward slashes only, no `.`/`..` segments, no drive letter (a definition written on one
# system must mean the same on every other, so a Windows or POSIX only spelling is refused).
RELATIVE_PATH_PATTERN = r'^(\.|[A-Za-z0-9_][A-Za-z0-9_.@+-]*(/[A-Za-z0-9_][A-Za-z0-9_.@+-]*)*)$'
# Names Windows cannot create as a file or folder: an id that is fine on Linux would break the checkout on Windows.
WINDOWS_RESERVED = frozenset({'con', 'prn', 'aux', 'nul', *(f'com{n}' for n in range(1, 10)), *(f'lpt{n}' for n in range(1, 10))})

ROLES = ('foreman', 'triage', 'spec', 'implement', 'review', 'verify', 'monitor', 'custom')
# Stages the definition configures; `intake` and `handoff` always exist (ADR 0055).
CONFIGURABLE_STAGES = ('triage', 'spec', 'implement', 'review', 'verify', 'monitor')
STAGE_ROLE = {stage: stage for stage in CONFIGURABLE_STAGES}
# The permission modes are the ADR 0021 modes, least to most capable. A harness run gives the model no tools (ADR 0045), so only the first
# two can carry one.
PERMISSION_MODES = tuple(mode['id'] for mode in json.loads(PERMISSION_MODES_PATH.read_text(encoding='utf-8'))['modes'])
MODE_ORDER = ('plan', 'read_only', 'ask', 'auto_workspace', 'workspace_write', 'full')
HARNESS_SAFE_MODES = ('plan', 'read_only')
DEFAULT_MODE = 'read_only'
DEFAULT_MAX_MODE = 'workspace_write'
EMBEDDED_SKILLS = ('forja-definition', 'forja-intake')
SPEC_APPROVALS = ('required', 'optional')
REVIEW_INDEPENDENCE = ('require', 'warn', 'off')
CREDENTIAL_STRATEGIES = ('forja', 'user')
RUNNER_KINDS = ('local',)  # Docker is reserved until it has proven isolation (ADR 0057)
MEMORY_LIMITS = {'maxNotes': 50, 'maxNoteChars': 400, 'maxTotalBytes': 20 * 1024}
INSTRUCTIONS_MAX_CHARS = 20_000
SKILL_MAX_CHARS = 20_000
MAX_TOKENS_CAP = 1_000_000_000
MAX_CONCURRENT_RUNS_CAP = 8
MAX_REVIEW_RETURNS_CAP = 10
POLICY_DEFAULTS = {'requireSpec': False, 'specApproval': 'required', 'maxReviewReturns': 3, 'reviewIndependence': 'require',
                   'maxPermissionMode': DEFAULT_MAX_MODE}
RUNNER_DEFAULTS = {'type': 'local', 'maxConcurrentRuns': 2, 'credentialStrategy': 'forja'}
# The layout (ADR 0056). `reserved` folders belong to packages B (parsed by their own code) and C (not read yet).
RESERVED_FOR_INTAKE = ('automations', 'webhooks')
RESERVED_FOR_SCORING = ('scorers', 'benchmarks')
ALLOWED_LOOSE_FILES = ('README.md', '.gitkeep')


def mode_rank(mode: str) -> int:
    return MODE_ORDER.index(mode)


def _text(max_len: int, min_len: int = 0) -> dict:
    return {'type': 'string', 'minLength': min_len, 'maxLength': max_len}


def _pattern(pattern: str) -> dict:
    return {'type': 'string', 'pattern': pattern}


def _object(properties: dict, required: tuple[str, ...] = ()) -> dict:
    schema: dict = {'type': 'object', 'additionalProperties': False, 'properties': properties}
    if required:
        schema['required'] = list(required)
    return schema


def _ints(low: int, high: int) -> dict:
    return {'type': 'integer', 'minimum': low, 'maximum': high}


def build_schema() -> dict:
    ident, secret_ref, model = _pattern(ID_PATTERN), _pattern(SECRET_REF_PATTERN), _pattern(MODEL_PATTERN)
    agent = _object({
        'role': {'enum': list(ROLES)},
        'model': model,
        'harness': ident,
        'instructions': _text(INSTRUCTIONS_MAX_CHARS),
        'skills': {'type': 'array', 'items': ident, 'uniqueItems': True, 'maxItems': 50},
        'localSkills': {'type': 'object', 'additionalProperties': False, 'maxProperties': 50, 'patternProperties': {ID_PATTERN: _object({'text': _text(SKILL_MAX_CHARS, 1)}, ('text',))}},
        'mcp': {'type': 'array', 'items': ident, 'uniqueItems': True, 'maxItems': 50},
        'permissions': _object({'mode': {'enum': list(PERMISSION_MODES)}, 'maxTokens': _ints(1, MAX_TOKENS_CAP)}, ('mode',)),
        'tokenCeiling': _ints(1, MAX_TOKENS_CAP),
        'secrets': {'type': 'array', 'items': secret_ref, 'uniqueItems': True, 'maxItems': 50},
        'memory': _object({key: _ints(1, cap) for key, cap in MEMORY_LIMITS.items()}, tuple(MEMORY_LIMITS)),
        'enabled': {'type': 'boolean'},
        'trigger': ident,
    }, ('role', 'model', 'instructions', 'skills', 'localSkills', 'mcp', 'permissions', 'secrets', 'memory', 'enabled'))
    return {
        '$schema': 'https://json-schema.org/draft/2020-12/schema',
        '$id': SCHEMA_ID,
        'title': 'Forja definition (the merged form of .oharness/forja)',
        **_object({
            'kind': {'const': KIND},
            'schemaVersion': {'const': SCHEMA_VERSION},
            'name': ident,
            'alias': ident,
            'defaults': _object({'model': model, 'harness': ident}),
            'repositories': {'type': 'array', 'minItems': 1, 'maxItems': 50, 'items': _object({
                'id': ident, 'path': _pattern(RELATIVE_PATH_PATTERN), 'subdir': _pattern(RELATIVE_PATH_PATTERN),
                'protectedBranches': {'type': 'array', 'minItems': 1, 'maxItems': 50, 'uniqueItems': True, 'items': _pattern(BRANCH_PATTERN)},
            }, ('id', 'path', 'protectedBranches'))},
            'tiers': {'type': 'object', 'additionalProperties': False, 'maxProperties': 10,
                      'patternProperties': {ID_PATTERN: _object({'models': {'type': 'array', 'minItems': 1, 'maxItems': 50, 'uniqueItems': True, 'items': model}}, ('models',))}},
            'ceilings': _object({'tokensPerWorkItem': _ints(1, MAX_TOKENS_CAP), 'tokensPerRun': _ints(1, MAX_TOKENS_CAP)}),
            'policy': _object({
                'requireSpec': {'type': 'boolean'}, 'specApproval': {'enum': list(SPEC_APPROVALS)},
                'maxReviewReturns': _ints(0, MAX_REVIEW_RETURNS_CAP), 'reviewIndependence': {'enum': list(REVIEW_INDEPENDENCE)},
                'maxPermissionMode': {'enum': list(PERMISSION_MODES)},
            }, tuple(POLICY_DEFAULTS)),
            'stages': _object({stage: _object({'enabled': {'type': 'boolean'}, 'required': {'type': 'boolean'}}) for stage in CONFIGURABLE_STAGES}),
            'runners': {'type': 'object', 'additionalProperties': False, 'maxProperties': 10, 'patternProperties': {ID_PATTERN: _object({
                'type': {'enum': list(RUNNER_KINDS)}, 'maxConcurrentRuns': _ints(1, MAX_CONCURRENT_RUNS_CAP),
                'credentialStrategy': {'enum': list(CREDENTIAL_STRATEGIES)}, 'pushSecretRef': secret_ref,
            }, ('type', 'maxConcurrentRuns', 'credentialStrategy'))}},
            'agents': {'type': 'object', 'additionalProperties': False, 'minProperties': 1, 'maxProperties': 50, 'patternProperties': {ID_PATTERN: agent}},
            'skills': {'type': 'object', 'additionalProperties': False, 'maxProperties': 100, 'patternProperties': {ID_PATTERN: _object({'text': _text(SKILL_MAX_CHARS, 1)}, ('text',))}},
            'mcp': {'type': 'object', 'additionalProperties': False, 'maxProperties': 50, 'patternProperties': {ID_PATTERN: {
                'oneOf': [
                    _object({'command': _text(200, 1), 'args': {'type': 'array', 'maxItems': 50, 'items': _text(500)},
                             'env': {'type': 'object', 'additionalProperties': False, 'maxProperties': 50, 'patternProperties': {r'^[A-Z_][A-Z0-9_]{0,63}$': secret_ref}}},
                            ('command',)),
                    _object({'url': _pattern(r'^https?://[^\s]{1,2000}$'),
                             'headers': {'type': 'object', 'additionalProperties': False, 'maxProperties': 50, 'patternProperties': {r'^[A-Za-z0-9-]{1,100}$': secret_ref}}},
                            ('url',)),
                ]}}},
            'reserved': _object({
                'automations': {'type': 'object', 'additionalProperties': {'type': 'string'}},
                'webhooks': {'type': 'object', 'additionalProperties': {'type': 'string'}},
            }),
        }, ('kind', 'schemaVersion', 'name', 'alias', 'defaults', 'repositories', 'tiers', 'ceilings', 'policy', 'stages', 'runners', 'agents',
            'skills', 'mcp', 'reserved')),
    }


def render_schema() -> str:
    return json.dumps(build_schema(), indent=2, sort_keys=True, ensure_ascii=False) + '\n'


if __name__ == '__main__':  # regenerate the committed schema: python -m factory.definition_rules (from backend/)
    SCHEMA_PATH.write_text(render_schema(), encoding='utf-8', newline='\n')
    print(f'wrote {SCHEMA_PATH}')
