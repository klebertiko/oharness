"""#339: the file commands the Workspace write mode lists must work where the OS has no mkdir/touch/cp/mv/ls/pwd program."""
import asyncio
import shutil
import sys

import pytest

from engine import RunControl
from sandbox import exec as sandbox_exec
from sandbox.broker import ToolBroker
from sandbox.schemas import ToolsRequest

FILE_COMMANDS = {'mkdir', 'touch', 'cp', 'mv', 'ls', 'pwd'}


@pytest.fixture(autouse=True)
def no_posix_tools(monkeypatch):
    """The native Windows PATH: no program of that name is found."""
    real = shutil.which
    monkeypatch.setattr(sandbox_exec.shutil, 'which', lambda name, *a, **k: None if name in FILE_COMMANDS else real(name, *a, **k))


def run_exec(root, argv, mode='workspace_write'):
    control = RunControl('builtin-broker')
    broker = ToolBroker(str(root), 'ollama', control, ToolsRequest(enabled=True), permission_mode=mode)

    async def collect():
        return [event async for event in broker.call('exec', {'argv': argv, 'cwd': '.', 'timeout_s': 20}, origin='model')]
    return asyncio.run(collect())


def result_of(events):
    return next(event for event in events if event['kind'] == 'tool_result')


def test_workspace_write_creates_copies_and_moves_without_the_posix_programs(tmp_path):
    for argv in (['mkdir', '-p', 'made/deep'], ['touch', 'made/deep/n.txt'], ['cp', 'made/deep/n.txt', 'made/c.txt'], ['mv', 'made/c.txt', 'made/m.txt']):
        events = run_exec(tmp_path, argv)
        assert 'tool_auto_approved' in [e['kind'] for e in events], argv
        assert result_of(events)['exit_code'] == 0 and result_of(events)['ok'], argv
    assert (tmp_path / 'made/deep/n.txt').is_file() and (tmp_path / 'made/m.txt').is_file()
    assert not (tmp_path / 'made/c.txt').exists()


def test_ls_and_pwd_work_in_the_read_only_mode(tmp_path):
    (tmp_path / 'b.txt').write_text('x')
    (tmp_path / 'a_dir').mkdir()
    listing = result_of(run_exec(tmp_path, ['ls'], mode='read_only'))
    assert listing['exit_code'] == 0 and listing['result'].splitlines() == ['a_dir', 'b.txt']
    assert result_of(run_exec(tmp_path, ['pwd'], mode='read_only'))['result'].strip() == str(tmp_path.resolve())


def test_recursive_copy_and_no_clobber(tmp_path):
    (tmp_path / 'src').mkdir()
    (tmp_path / 'src' / 'f.txt').write_text('one')
    assert result_of(run_exec(tmp_path, ['cp', '-r', 'src', 'dst']))['exit_code'] == 0
    assert (tmp_path / 'dst' / 'f.txt').read_text() == 'one'
    (tmp_path / 'keep.txt').write_text('keep')
    (tmp_path / 'other.txt').write_text('other')
    run_exec(tmp_path, ['cp', '-n', 'other.txt', 'keep.txt'])
    assert (tmp_path / 'keep.txt').read_text() == 'keep'


def test_a_failing_command_reports_its_reason_and_a_non_zero_exit(tmp_path):
    result = result_of(run_exec(tmp_path, ['cp', 'missing.txt', 'x.txt']))
    assert result['exit_code'] == 1 and not result['ok'] and 'missing.txt' in result['result']
    assert not (tmp_path / 'x.txt').exists()


def test_a_flag_the_built_in_does_not_implement_is_refused_not_ignored(tmp_path):
    result = result_of(run_exec(tmp_path, ['mkdir', '-m', '777', 'd'], mode='full'))
    assert result['exit_code'] == 2 and not (tmp_path / 'd').exists()


def test_a_program_that_is_not_installed_says_so(tmp_path):
    events = run_exec(tmp_path, ['definitely-not-installed-tool', '--version'], mode='full')
    result = result_of(events)
    assert not result['ok'] and 'definitely-not-installed-tool' in result['result'] and 'not installed' in result['result']
    assert 'Unable to start' not in result['result']


def test_a_real_program_still_runs_normally(tmp_path):
    result = result_of(run_exec(tmp_path, [sys.executable, '--version'], mode='full'))
    assert result['exit_code'] == 0 and 'Python' in result['result']
