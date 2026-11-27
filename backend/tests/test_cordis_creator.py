"""The `cordis_plugins` tool of the agent (creator mode): a development area it may write in, and install requests a person approves."""
from __future__ import annotations

import json
import os
import sys

import pytest

from cordis import creator
from cordis.creator import DevArea, DevError
from cordis.service import CordisService


@pytest.fixture()
def area(tmp_path):
    return DevArea(tmp_path / 'dev')


@pytest.mark.parametrize('kind', ['tool', 'command', 'service'])
def test_scaffold_writes_a_minimal_isolated_package_without_capabilities(area, kind):
    made = area.scaffold('notes-helper', kind)
    manifest = json.loads((area.root / 'notes-helper' / 'package.json').read_text(encoding='utf8'))
    assert manifest['name'] == 'notes-helper' and manifest['main'] == './index.ts' and manifest['type'] == 'module'
    assert manifest['oharness'] == {'runtime': 'isolated', 'capabilities': []}
    assert 'scripts' not in manifest and 'dependencies' not in manifest
    code = (area.root / 'notes-helper' / 'index.ts').read_text(encoding='utf8')
    assert 'export function apply(ctx' in code and 'notes-helper' in code
    assert sorted(made['files']) == ['index.ts', 'package.json']


def test_scaffold_refuses_an_existing_package_and_bad_names(area):
    area.scaffold('dup', 'tool')
    with pytest.raises(DevError) as exists:
        area.scaffold('dup', 'tool')
    assert exists.value.code == 'exists'
    for bad in ('', 'Upper', '../x', 'a/b', 'x' * 65, '.hidden', 'con'):
        with pytest.raises(DevError):
            area.scaffold(bad, 'tool')
    with pytest.raises(DevError):
        area.scaffold('ok-name', 'widget')


@pytest.mark.parametrize('path', ['../escape.ts', '/abs.ts', 'C:/abs.ts', 'a/../../b.ts', 'a\\b.ts', '', '.', 'src/', 'x:y.ts', '.env'])
def test_write_refuses_paths_that_leave_the_package_or_are_not_plain(area, path):
    area.scaffold('pkg', 'tool')
    with pytest.raises(DevError) as error:
        area.write('pkg', path, 'x')
    assert error.value.code == 'invalid_path'


def test_write_and_read_round_trip_inside_the_package_with_a_size_ceiling(area):
    area.scaffold('pkg', 'tool')
    area.write('pkg', 'src/util.ts', 'export const x = 1\n')
    assert area.read('pkg', 'src/util.ts') == 'export const x = 1\n'
    with pytest.raises(DevError) as big:
        area.write('pkg', 'big.ts', 'x' * (creator.MAX_FILE_BYTES + 1))
    assert big.value.code == 'too_large'
    with pytest.raises(DevError) as missing:
        area.read('pkg', 'nope.ts')
    assert missing.value.code == 'not_found'
    with pytest.raises(DevError):
        area.write('ghost', 'index.ts', 'x')  # write never creates a package; scaffold does


def test_write_refuses_to_go_through_a_link(area, tmp_path):
    area.scaffold('pkg', 'tool')
    outside = tmp_path / 'outside'
    outside.mkdir()
    link = area.root / 'pkg' / 'linked'
    try:
        os.symlink(outside, link, target_is_directory=True)
    except (OSError, NotImplementedError):
        if sys.platform != 'win32':
            pytest.skip('this system does not let the test make a link')
        import _winapi
        _winapi.CreateJunction(str(outside), str(link))  # a junction needs no privilege on Windows
    with pytest.raises(DevError) as error:
        area.write('pkg', 'linked/x.ts', 'x')
    assert error.value.code == 'invalid_path'
    assert not (outside / 'x.ts').exists()


def test_digest_changes_with_the_files(area):
    area.scaffold('pkg', 'tool')
    first = area.digest('pkg')
    area.write('pkg', 'index.ts', 'export function apply(ctx) {}\n')
    assert area.digest('pkg') != first


def test_the_tool_validates_its_arguments_and_reports_status_and_next_step(tmp_path):
    service = CordisService(tmp_path, enabled=False)
    made = creator.run_action(service, {'action': 'scaffold', 'name': 'echo-me', 'kind': 'tool'})
    assert made['status'] == 'applied' and made['nextStep']
    wrote = creator.run_action(service, {'action': 'write_file', 'name': 'echo-me', 'path': 'index.ts', 'content': 'export function apply(ctx) {}\n'})
    assert wrote['status'] == 'applied'
    read = creator.run_action(service, {'action': 'read_file', 'name': 'echo-me', 'path': 'index.ts'})
    assert read['status'] == 'applied' and read['content'].startswith('export function apply')
    listed = creator.run_action(service, {'action': 'list'})
    assert [p['name'] for p in listed['packages']] == ['echo-me'] and listed['status'] == 'applied'
    bad = creator.run_action(service, {'action': 'write_file', 'name': 'echo-me', 'path': '../x', 'content': ''})
    assert bad['status'] == 'failed' and bad['error'] == 'invalid_path' and bad['nextStep']
    assert creator.run_action(service, {'action': 'install'})['status'] == 'failed'  # there is no install action
    assert creator.run_action(service, {'action': 'list', 'extra': 1})['status'] == 'failed'
    # without a running host, preview and request_install fail with a reason instead of raising
    down = creator.run_action(service, {'action': 'request_install', 'name': 'echo-me'})
    assert down['status'] == 'failed' and down['nextStep']


# Creator mode per thread: test_cordis_thread_creator.py.


def test_the_skill_explains_the_host_api_and_the_flow():
    text = creator.skill_prompt()
    for phrase in ('apply(ctx)', 'ctx.tools', 'ctx.commands', 'oharness.runtime', 'capabilities', 'request_install', 'api_catalog', 'starters', 'never run'):
        assert phrase in text, phrase
    assert len(text) < 9000
