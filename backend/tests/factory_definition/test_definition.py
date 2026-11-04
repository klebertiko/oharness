"""Definition as code: layout → one validated definition, hash, errors that never carry a value (ADR 0056)."""
from __future__ import annotations

import json
import os

import pytest

from factory import definition, definition_rules
from factory_definition_files import FACTORY, FILES, agent_md

SECRET = 'sk-' + 'a' * 30
BUILDER = ('implement', 'openai/gpt-4o', 'workspace_write')
REVIEWER = ('review', 'anthropic/claude-opus', 'read_only')


def _issues(root):
    return definition.load(root).issues


def _paths(issues):
    return {i.path for i in issues if i.severity == 'error'}


def _factory(extra: str = '') -> str:
    return FACTORY + extra


def test_a_valid_definition_loads_with_a_hash_and_resolved_defaults(make_definition):
    loaded = definition.load(make_definition())
    assert loaded.ok and loaded.issues == []
    assert len(loaded.hash) == 64
    builder = loaded.definition['agents']['builder']
    assert builder['instructions'] == 'Do the job.' and builder['enabled'] is True and builder['secrets'] == []
    assert loaded.definition['agents']['foreman']['model'] == 'openai/gpt-4o'  # from defaults
    assert loaded.definition['policy']['maxReviewReturns'] == 3


def test_hash_ignores_line_endings(make_definition):
    first = definition.load(make_definition())
    crlf = definition.load(make_definition({k: v.replace('\n', '\r\n') for k, v in FILES.items()}))
    assert crlf.ok and crlf.hash == first.hash


def test_hash_changes_when_an_instruction_changes(make_definition):
    first = definition.load(make_definition())
    second = definition.load(make_definition({'agents/builder/agent.md': agent_md(*BUILDER, body='Different.')}))
    assert first.hash != second.hash


def test_missing_directory_is_not_found(tmp_path):
    with pytest.raises(definition.DefinitionNotFound):
        definition.load(tmp_path / 'nope')


def test_missing_factory_yaml(make_definition):
    assert 'factory.yaml' in {i.file for i in _issues(make_definition({'factory.yaml': None}))}


def test_unknown_field_is_rejected_by_not_existing(make_definition):
    issues = _issues(make_definition({'factory.yaml': _factory('apiToken: ' + 'abcdefgh' + '12345\n')}))
    assert any('apiToken' in i.message for i in issues)
    assert 'abcdefgh' + '12345' not in json.dumps([i.as_dict() for i in issues])


def test_a_credential_in_instructions_is_rejected_without_echoing_it(make_definition):
    root = make_definition({'agents/builder/agent.md': agent_md(*BUILDER, body=f'use {SECRET} here')})
    issues = _issues(root)
    assert 'agents.builder.instructions' in _paths(issues)
    assert SECRET not in json.dumps([i.as_dict() for i in issues])


def test_secret_refs_have_one_shape(make_definition):
    good = make_definition({'agents/builder/agent.md': agent_md(*BUILDER, extra='secrets: [factory/npm-registry]')})
    assert definition.load(good).ok
    for bad in ('oharness/x', 'factory/', 'ghp_' + 'x' * 36, 'factory/has space'):
        root = make_definition({'agents/builder/agent.md': agent_md(*BUILDER, extra=f'secrets: ["{bad}"]')})
        issues = _issues(root)
        assert 'agents.builder.secrets[0]' in _paths(issues), bad
        assert len(bad) < 10 or bad not in json.dumps([i.as_dict() for i in issues])  # the hint itself spells factory/<name>


@pytest.mark.parametrize('path', ['../outside', '/etc', 'C:\\\\repo', 'a\\\\b', 'a/../b', './a', 'a//b', '~/x', 'a/.git/../b'])
def test_repository_paths_cannot_leave_the_repository(make_definition, path):
    text = _factory().replace('path: .', f'path: "{path}"')
    assert 'repositories[0].path' in _paths(_issues(make_definition({'factory.yaml': text})))


def test_exactly_one_foreman(make_definition):
    assert 'agents' in _paths(_issues(make_definition({'agents/foreman/agent.md': None})))
    assert 'agents' in _paths(_issues(make_definition({'agents/second/agent.md': agent_md('foreman')})))


def test_cross_references(make_definition):
    root = make_definition({
        'agents/builder/agent.md': agent_md(*BUILDER, extra='skills: [ghost]\nmcp: [nothing]'),
        'agents/reviewer/agent.md': agent_md('review', 'unknown/model', 'read_only'),
    })
    assert {'agents.builder.skills[0]', 'agents.builder.mcp[0]', 'agents.reviewer.model'} <= _paths(_issues(root))


def test_skills_and_mcp_resolve(make_definition):
    root = make_definition({
        'agents/builder/agent.md': agent_md(*BUILDER, extra='skills: [lint, own, factory-definition]\nmcp: [docs]'),
        'skills/lint/SKILL.md': '# lint\nRun the linter.\n',
        'agents/builder/skills/own/SKILL.md': '# own\n',
        'mcp/docs.yaml': 'command: docs-server\nargs: [--stdio]\nenv:\n  DOCS_KEY: factory/docs-key\n',
    })
    loaded = definition.load(root)
    assert loaded.ok, [i.as_dict() for i in loaded.issues]
    assert loaded.definition['mcp']['docs']['env'] == {'DOCS_KEY': 'factory/docs-key'}
    assert 'own' in loaded.definition['agents']['builder']['localSkills']


def test_custom_agents_do_not_get_embedded_skills(make_definition):
    root = make_definition({'agents/helper/agent.md': agent_md('custom', 'openai/gpt-4o', 'read_only', 'skills: [factory-intake]')})
    assert 'agents.helper.skills[0]' in _paths(_issues(root))


def test_a_harness_only_goes_on_an_agent_that_cannot_write(make_definition):
    ok = make_definition({'agents/reviewer/agent.md': agent_md(*REVIEWER, extra='harness: review-flow')})
    assert definition.load(ok).ok
    bad = make_definition({'agents/builder/agent.md': agent_md(*BUILDER, extra='harness: build-flow')})
    assert 'agents.builder.harness' in _paths(_issues(bad))


def test_an_agent_never_exceeds_the_mode_the_factory_declares(make_definition):
    full = agent_md('implement', 'openai/gpt-4o', 'full')
    assert 'agents.builder.permissions.mode' in _paths(_issues(make_definition({'agents/builder/agent.md': full})))
    raised = make_definition({'factory.yaml': _factory('policy:\n  maxPermissionMode: full\n'), 'agents/builder/agent.md': full})
    assert definition.load(raised).ok


def test_ceilings_bound_the_agents(make_definition):
    root = make_definition({'agents/builder/agent.md': agent_md(*BUILDER, extra='tokenCeiling: 999999')})
    assert 'agents.builder.tokenCeiling' in _paths(_issues(root))


def test_required_stage_needs_an_enabled_agent(make_definition):
    off = make_definition({'agents/reviewer/agent.md': agent_md(*REVIEWER, extra='enabled: false')})
    assert 'stages.review' in _paths(_issues(off))
    spec = make_definition({'factory.yaml': _factory('policy:\n  requireSpec: true\n')})
    assert 'stages.spec' in _paths(_issues(spec))


def test_partial_adoption_is_valid(make_definition):
    # only the foreman and a triage agent: nothing else is required, the rest of the work waits for a person
    root = make_definition({'factory.yaml': _factory().replace('stages:\n  review:\n    required: true\n', ''),
                            'agents/builder/agent.md': None, 'agents/reviewer/agent.md': None,
                            'agents/triager/agent.md': agent_md('triage', 'openai/gpt-4o-mini', 'read_only')})
    assert definition.load(root).ok


def test_unexpected_files_are_errors_not_ignored(make_definition):
    root = make_definition({'agents/builder/agent.yml': 'role: implement\n', 'notes.txt': 'x', 'README.md': 'fine'})
    files = {i.file for i in _issues(root)}
    assert {'agents/builder/agent.yml', 'notes.txt'} <= files and 'README.md' not in files


def test_yaml_aliases_and_duplicate_keys_are_refused(make_definition):
    aliased = _factory().replace('models: [openai/gpt-4o-mini]', 'models: &m [openai/gpt-4o-mini]').replace('models: [openai/gpt-4o, anthropic/claude-opus]', 'models: *m')
    assert any(i.file == 'factory.yaml' and 'anchor' in i.message.lower() for i in _issues(make_definition({'factory.yaml': aliased})))
    assert any(i.file == 'factory.yaml' for i in _issues(make_definition({'factory.yaml': _factory('alias: other\n')})))


def test_files_over_the_size_limit_are_refused(make_definition):
    big = agent_md(*BUILDER, body='x' * (definition_rules.MAX_FILE_BYTES + 1))
    assert any(i.file == 'agents/builder/agent.md' and 'large' in i.message for i in _issues(make_definition({'agents/builder/agent.md': big})))


def test_ids_that_windows_cannot_create_are_refused(make_definition):
    root = make_definition({'agents/con/agent.md': agent_md('custom', 'openai/gpt-4o', 'read_only')})
    assert any('windows' in i.message.lower() for i in _issues(root))


def test_symbolic_links_are_not_followed(make_definition, tmp_path):
    root = make_definition()
    outside = tmp_path / 'outside.md'
    outside.write_text(agent_md('custom', 'openai/gpt-4o', 'read_only'), encoding='utf-8')
    link = root / 'agents' / 'helper' / 'agent.md'
    link.parent.mkdir(parents=True)
    try:
        os.symlink(outside, link)
    except (OSError, NotImplementedError):
        pytest.skip('symbolic links need a privilege this machine does not grant')
    assert any(i.file == 'agents/helper/agent.md' and 'symbolic' in i.message for i in _issues(root))


def test_a_utf8_bom_is_tolerated(make_definition):
    assert definition.load(make_definition({'factory.yaml': '\ufeff' + _factory()})).ok


def test_reserved_intake_files_are_checked_by_their_own_parsers(make_definition):
    assert definition.load(make_definition({'webhooks/gh.yaml': 'authMode: token\nsecretRef: factory/gh\n'})).ok
    bad = make_definition({'webhooks/gh.yaml': 'authMode: token\nsecretRef: oops\n'})
    assert any(i.file == 'webhooks/gh.yaml' for i in _issues(bad))


def test_the_committed_schema_is_the_generated_one():
    assert definition_rules.SCHEMA_PATH.read_text(encoding='utf-8') == definition_rules.render_schema(), (
        'regenerate it: python -m factory.definition_rules (from backend/)')


def _walk(node, path=()):
    yield path, node
    if isinstance(node, dict):
        for key, child in node.items():
            yield from _walk(child, path + (key,))
    elif isinstance(node, list):
        for index, child in enumerate(node):
            yield from _walk(child, path + (index,))


def test_every_object_of_the_schema_is_closed_and_secret_fields_take_only_a_reference():
    for path, node in _walk(definition_rules.build_schema()):
        if isinstance(node, dict) and node.get('type') == 'object' and path[-1:] not in (('automations',), ('webhooks',)):
            assert node.get('additionalProperties') is False, path
        if isinstance(node, dict) and isinstance(node.get('properties'), dict):
            for name, prop in node['properties'].items():
                if 'secret' in name.lower():
                    assert definition_rules.SECRET_REF_PATTERN in (prop.get('pattern'), prop.get('items', {}).get('pattern')), (path, name)


def test_every_free_text_field_goes_through_the_value_check():
    # The validator scans every string of the merged definition; the free-text fields of the schema are exactly the ones named there.
    free = set()
    for path, node in _walk(definition_rules.build_schema()):
        if isinstance(node, dict) and node.get('type') == 'string' and not {'pattern', 'enum', 'const'} & node.keys():
            free.add(path[-2] if path[-1] in ('items', 'additionalProperties') else path[-1])
    assert free <= definition.FREE_TEXT_FIELDS


def test_diff_reports_added_removed_and_changed_fields(make_definition):
    first = definition.load(make_definition()).definition
    second = definition.load(make_definition({
        'agents/builder/agent.md': agent_md(*BUILDER, body='New words.'),
        'agents/reviewer/agent.md': None,
        'agents/extra/agent.md': agent_md('custom', 'openai/gpt-4o', 'read_only'),
        'factory.yaml': _factory().replace('stages:\n  review:\n    required: true\n', ''),
    })).definition
    changes = {c.path: c for c in definition.diff(first, second)}
    assert changes['agents.builder.instructions'].op == 'changed' and changes['agents.builder.instructions'].after == 'New words.'
    assert changes['agents.extra'].op == 'added' and changes['agents.reviewer'].op == 'removed'
    assert changes['stages.review'].op == 'removed'
    assert definition.diff(first, first) == []


def test_the_mock_check_walks_example_work_items_through_the_definition(make_definition):
    report = definition.check(definition.load(make_definition()).definition)
    assert report.ok and [e.name for e in report.examples] == ['small-fix', 'needs-spec', 'ambiguous']
    assert report.examples[0].stages == ['implement', 'review']  # no triage agent: the stage is not in the path


def test_the_mock_check_fails_when_review_cannot_be_independent(make_definition):
    same = make_definition({'agents/reviewer/agent.md': agent_md('review', 'openai/gpt-4o', 'read_only')})
    report = definition.check(definition.load(same).definition)
    assert not report.ok and any('independen' in problem for problem in report.problems)
    relaxed = make_definition({'agents/reviewer/agent.md': agent_md('review', 'openai/gpt-4o', 'read_only'),
                               'factory.yaml': _factory('policy:\n  reviewIndependence: off\n')})
    assert definition.check(definition.load(relaxed).definition).ok


# ---- SEC review: secrets that the shared patterns miss, echoed values, hostile files, pinned activation

COMMON_SECRETS = ['sk-ant-api03-' + 'A1b2' * 8, 'AIza' + 'Sy' * 18, 'Bearer eyJ' + 'a' * 30, 'sk_live_' + 'x1' * 14,
                  'github_pat_' + 'a1' * 20, 'https://user:' + 'p4ss' * 3 + '@host.example/x']


@pytest.mark.parametrize('secret', COMMON_SECRETS)
def test_common_credential_shapes_are_refused_and_never_echoed(make_definition, secret):
    root = make_definition({'agents/builder/agent.md': agent_md(*BUILDER, body=f'call with {secret} please')})
    issues = _issues(root)
    assert 'agents.builder.instructions' in _paths(issues)
    assert secret not in json.dumps([i.as_dict() for i in issues])


def test_a_credential_flag_in_mcp_args_is_refused(make_definition):
    root = make_definition({'mcp/docs.yaml': 'command: docs-server\nargs: [--api-key, ' + 'abcdefgh' + '12345678]\n'})
    issues = _issues(root)
    assert any(i.file == 'mcp/docs.yaml' for i in issues) and ('abcdefgh' + '12345678') not in json.dumps([i.as_dict() for i in issues])


def test_secret_looking_names_are_not_echoed_in_any_issue(make_definition):
    secret = 'sk-ant-api03-' + 'A1b2' * 8
    cases = [
        {'factory.yaml': _factory(f'{secret}: 1\n')},
        {f'{secret}.txt': 'x'},
        {'webhooks/gh.yaml': f'authMode: token\nsecretRef: factory/gh\n{secret}: 1\n'},
        {'automations/job/automation.md': f'---\nprovider: {secret}\n---\nbody\n'},
    ]
    for changes in cases:
        issues = _issues(make_definition(changes))
        assert issues and secret not in json.dumps([i.as_dict() for i in issues]), changes


def test_deeply_nested_yaml_is_refused_not_a_crash(make_definition):
    for nest in ('[' * 30000, '{a: ' * 3000):
        issues = _issues(make_definition({'mcp/docs.yaml': 'command: x\nargs: ' + nest + '\n'}))
        assert any(i.file == 'mcp/docs.yaml' and 'depth' in i.message for i in issues)
    deep_indent = ''.join(' ' * (2 * n) + f'k{n}:\n' for n in range(200))
    assert any('depth' in i.message for i in _issues(make_definition({'factory.yaml': _factory() + 'x-deep:\n' + deep_indent})))


def test_non_string_keys_are_an_issue_not_a_crash(make_definition):
    assert any(i.file == 'factory.yaml' for i in _issues(make_definition({'factory.yaml': _factory('1: a\n')})))


def test_a_linked_definition_root_is_not_followed(tmp_path, make_definition):
    real = make_definition()
    link = tmp_path / 'linked'
    try:
        os.symlink(real, link, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip('symbolic links need a privilege this machine does not grant')
    assert any('symbolic' in i.message for i in definition.load(link).issues)


def test_a_trailing_newline_does_not_pass_a_single_line_field(make_definition):
    assert not definition.load(make_definition({'factory.yaml': _factory().replace('name: payments', 'name: "payments\n"')})).ok


def test_repository_paths_avoid_windows_device_names(make_definition):
    for bad in ('con', 'src/aux', 'nul.txt', 'a/trailing.'):
        text = _factory().replace('path: .', f'path: {bad}')
        assert 'repositories[0].path' in _paths(_issues(make_definition({'factory.yaml': text}))), bad


def test_too_many_folders_are_refused(make_definition):
    root = make_definition()
    for n in range(definition_rules.MAX_FOLDERS + 5):
        (root / 'skills' / f's{n}').mkdir(parents=True, exist_ok=True)
    assert any('folders' in i.message for i in _issues(root))


def test_a_whole_float_is_the_same_value_as_the_integer(make_definition):
    plain = definition.load(make_definition())
    floaty = definition.load(make_definition({'factory.yaml': _factory().replace('tokensPerRun: 100000', 'tokensPerRun: 100000.0')}))
    assert floaty.ok and floaty.hash == plain.hash


def test_a_secret_used_as_a_key_is_not_echoed_in_the_path_of_a_nested_issue(make_definition):
    secret = 'sk-ant-api03-' + 'A1b2' * 8
    text = _factory('policy:\n  ' + secret + ': ' + secret + '\n')
    issues = _issues(make_definition({'factory.yaml': text}))
    assert issues and secret not in json.dumps([i.as_dict() for i in issues])


def test_block_sequence_indicators_on_one_line_count_as_nesting(make_definition):
    for nest in ('- ' * 3000 + 'x', '? ' * 3000 + 'x'):
        issues = _issues(make_definition({'mcp/docs.yaml': 'command: x\nargs:\n' + nest + '\n'}))
        assert any(i.file == 'mcp/docs.yaml' for i in issues)  # refused by depth or by profile, never a crash


def test_a_file_swapped_for_a_link_after_the_walk_is_not_read(make_definition, tmp_path):
    root = make_definition()
    outside = tmp_path / 'outside.yaml'
    outside.write_text('x: 1\n', encoding='utf-8')
    swapped = root / 'mcp' / 'docs.yaml'
    swapped.parent.mkdir(exist_ok=True)
    try:
        os.symlink(outside, swapped)
    except (OSError, NotImplementedError):
        pytest.skip('symbolic links need a privilege this machine does not grant')
    with pytest.raises(definition._FileProblem):
        definition._read(root, 'mcp/docs.yaml')


def test_a_huge_integer_is_an_issue_not_a_crash(make_definition):
    text = _factory().replace('tokensPerRun: 100000', 'tokensPerRun: ' + '9' * 5000)
    assert any(i.file == 'factory.yaml' for i in _issues(make_definition({'factory.yaml': text})))


def test_the_credential_scan_is_linear_on_hostile_text(make_definition):
    import time
    started = time.monotonic()
    _issues(make_definition({'agents/builder/agent.md': agent_md(*BUILDER, body='x' * 200_000)}))
    assert time.monotonic() - started < 5
