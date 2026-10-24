r"""P3 follow-ups of the #146 security review (issue #147).

* every operand/flag grammar ends with `\Z`, not `$` (which also accepts a trailing newline);
* a failed `git --version` probe is not cached for the life of the process (and is retried at a bounded rate);
* the git that runs is the git the policy looked at.
"""
import shutil

import pytest

from sandbox import exec as sandbox_exec
from sandbox import permission

NEWLINE_CASES = [
    ('_PYTEST_NODE', 'tests/a.py'),
    ('_SCRIPT_NAME', 'build'),
    ('_PYTEST_TB', '--tb=short'),
    ('_LS_FLAGS', '-l'),
    ('_LS_OPERAND', 'build'),
]


@pytest.mark.parametrize('name, ok', NEWLINE_CASES)
def test_grammars_accept_the_operand_but_not_the_operand_plus_a_newline(name, ok):
    pattern = getattr(permission, name)
    assert pattern.match(ok) is not None
    assert pattern.match(ok + '\n') is None


def test_ls_and_pytest_ask_for_an_operand_with_a_trailing_newline(tmp_path):
    (tmp_path / 'build').mkdir()
    assert permission._ls_ok(['build'], str(tmp_path)) is True
    assert permission._ls_ok(['build\n'], str(tmp_path)) is False
    assert permission._ls_ok(['-l\n'], str(tmp_path)) is False
    assert permission._pytest_ok(['--tb=short\n'], True, str(tmp_path)) is False


@pytest.fixture
def fresh_git_version(monkeypatch):
    monkeypatch.setattr(permission._GIT_PROBE, 'version', ())
    monkeypatch.setattr(permission._GIT_PROBE, 'failed_at', None)


def test_a_transient_git_version_failure_is_not_remembered(monkeypatch, fresh_git_version):
    monkeypatch.setattr(permission, '_GIT_VERSION_RETRY_S', 0.0)
    answers = iter([None, b'git version 2.45.0\n'])
    monkeypatch.setattr(permission, '_git_run', lambda args, cwd: next(answers))
    assert permission._git_version() == ()
    assert permission._git_version() == (2, 45, 0)


def test_a_known_git_version_is_cached(monkeypatch, fresh_git_version):
    calls = []

    def run(args, cwd):
        calls.append(args)
        return b'git version 2.45.0\n'
    monkeypatch.setattr(permission, '_git_run', run)
    assert permission._git_version() == (2, 45, 0)
    assert permission._git_version() == (2, 45, 0)
    assert len(calls) == 1


def test_a_failing_git_is_retried_at_a_bounded_rate(monkeypatch, fresh_git_version):
    calls = []

    def run(args, cwd):
        calls.append(args)
        return None
    monkeypatch.setattr(permission, '_git_run', run)
    monkeypatch.setattr(permission, '_GIT_VERSION_RETRY_S', 3600.0)
    assert permission._git_version() == ()
    assert permission._git_version() == ()
    assert len(calls) == 1


@pytest.mark.skipif(shutil.which('git') is None, reason='git is not installed')
def test_exec_runs_the_git_the_policy_resolved(monkeypatch):
    monkeypatch.setattr(permission, '_GIT_EXE', '/pinned/by/the/policy/git')
    assert sandbox_exec._argv(['git', 'status'])[0] == '/pinned/by/the/policy/git'
    assert sandbox_exec._argv(['git', 'status'])[1:] == ['status']


def test_exec_still_searches_path_for_other_programs():
    assert sandbox_exec._argv(['python3', '-V'])[0].endswith('python3')
