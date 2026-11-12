"""The human credential (ADR 0055) lives in the sidecar's environment only; nothing the sidecar spawns may inherit it."""
from __future__ import annotations

from adapters.cli_shared import scrub_env
from factory.auth import HUMAN_ENV
from sandbox.exec import scrub_env as sandbox_scrub_env


def test_tool_and_cli_environments_never_carry_the_human_credential(monkeypatch):
    monkeypatch.setenv(HUMAN_ENV, 'human-secret')
    monkeypatch.setenv('OH_SIDECAR_TOKEN', 'sidecar-secret')
    for scrub in (scrub_env, sandbox_scrub_env):
        env = scrub({'EXTRA': '1'})
        assert 'human-secret' not in env.values()
        assert 'sidecar-secret' not in env.values()
        assert HUMAN_ENV not in {key.upper() for key in env}


def test_git_and_icacls_children_never_inherit_the_credentials(monkeypatch, tmp_path):
    """A canary in the environment must not reach the two child processes the sidecar starts on its own (git in the policy, icacls for the token file)."""
    import subprocess

    from sandbox import permission
    from security import sidecar_token

    monkeypatch.setenv(HUMAN_ENV, 'canary-human')
    monkeypatch.setenv('OH_SIDECAR_TOKEN', 'canary-sidecar')
    seen = []

    def fake_run(*args, **kwargs):
        seen.append(kwargs.get('env'))
        return subprocess.CompletedProcess(args, 0, stdout=b'', stderr=b'')

    monkeypatch.setattr(permission.subprocess, 'run', fake_run)
    monkeypatch.setattr(permission, '_GIT_EXE', 'git')
    permission._git_run(['--version'], str(tmp_path))
    monkeypatch.setattr(sidecar_token.platform, 'system', lambda: 'Windows')
    monkeypatch.setattr(sidecar_token.subprocess, 'run', fake_run)
    sidecar_token.restrict_to_current_user(tmp_path)
    assert len(seen) == 2 and all(env is not None for env in seen), 'both children must get an explicit environment'
    for env in seen:
        assert 'canary-human' not in env.values() and 'canary-sidecar' not in env.values()


def test_the_credential_comes_by_stdin_and_never_sits_in_the_environment(monkeypatch):
    import io
    from types import SimpleNamespace

    from factory import auth

    monkeypatch.setattr(auth, '_held', None)
    monkeypatch.setenv('OH_HUMAN_STDIN', '1')
    monkeypatch.delenv(HUMAN_ENV, raising=False)
    auth.load_human_credential(io.StringIO('from-stdin-secret\n'))
    import os
    assert HUMAN_ENV not in os.environ and 'OH_HUMAN_STDIN' not in os.environ
    ok = SimpleNamespace(headers={auth.HUMAN_HEADER: 'from-stdin-secret'})
    assert auth.credential_class(ok) == 'human'
    assert auth.credential_class(SimpleNamespace(headers={auth.HUMAN_HEADER: 'other'})) == 'agent'
    monkeypatch.setattr(auth, '_held', None)


def test_a_closed_or_empty_stdin_leaves_no_human_credential(monkeypatch):
    import io
    from types import SimpleNamespace

    from factory import auth

    monkeypatch.setattr(auth, '_held', None)
    monkeypatch.setenv('OH_HUMAN_STDIN', '1')
    monkeypatch.delenv(HUMAN_ENV, raising=False)
    auth.load_human_credential(io.StringIO(''))
    assert auth.credential_class(SimpleNamespace(headers={auth.HUMAN_HEADER: ''})) == 'agent' and not auth.human_available()


def test_a_credential_given_in_the_environment_is_moved_out_of_it(monkeypatch):
    import os

    from factory import auth

    monkeypatch.setattr(auth, '_held', None)
    monkeypatch.setenv(HUMAN_ENV, 'env-secret')
    auth.load_human_credential()
    assert HUMAN_ENV not in os.environ and auth._held == 'env-secret'
    monkeypatch.setattr(auth, '_held', None)
