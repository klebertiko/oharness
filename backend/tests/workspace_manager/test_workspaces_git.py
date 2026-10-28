"""The one git runner of the Workspace Manager, and the ref/branch validation in front of it."""
from __future__ import annotations

import os
import sys

import pytest

from workspaces.errors import WorkspaceError
from workspaces.gitrun import GitFailure
from workspaces.validation import validate_branch_name, validate_ref
from workspaces_support import posix


def test_git_is_an_absolute_path(runner):
    assert os.path.isabs(runner.git_path)
    assert os.path.exists(runner.git_path)


def test_inherited_git_environment_is_dropped(runner, repo, monkeypatch, tmp_path):
    other = tmp_path / "other"
    other.mkdir()
    monkeypatch.setenv("GIT_DIR", str(other))
    monkeypatch.setenv("GIT_WORK_TREE", str(other))
    monkeypatch.setenv("GIT_INDEX_FILE", str(other / "idx"))
    monkeypatch.setenv("GIT_CONFIG_COUNT", "1")
    monkeypatch.setenv("GIT_CONFIG_KEY_0", "core.hooksPath")
    monkeypatch.setenv("GIT_CONFIG_VALUE_0", str(other))
    top = runner.run(repo.path, ["rev-parse", "--show-toplevel"]).stdout.decode().strip()
    assert os.path.samefile(top, repo.path)


def test_unrelated_secrets_are_not_passed_to_git(runner, repo, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-should-never-reach-git")
    done = runner.run(repo.path, ["-c", "alias.dumpenv=!env", "dumpenv"])
    text = done.stdout.decode("utf-8", "replace")
    assert "sk-or-should-never-reach-git" not in text
    assert "GIT_TERMINAL_PROMPT=0" in text
    assert "GIT_CONFIG_NOSYSTEM=1" in text
    assert "GIT_CONFIG_GLOBAL=" in text


def test_user_global_git_config_is_ignored(runner, repo, oh_env):
    (oh_env.home / ".gitconfig").write_text("[user]\n\tname = GlobalEvil\n[alias]\n\tpoison = !exit 9\n", encoding="utf-8")
    done = runner.run(repo.path, ["config", "--get", "user.name"], check=False)
    assert done.returncode != 0 and done.stdout.strip() == b""


def test_option_shaped_arguments_are_data_not_options(runner, repo):
    with pytest.raises(GitFailure):
        runner.run(repo.path, ["rev-parse", "--verify", "--end-of-options", "--upload-pack=touch pwned"])
    assert not (repo.path / "pwned").exists()


def test_a_timeout_is_reported_as_a_workspace_error(runner, repo):
    slow = f"!\"{posix(sys.executable)}\" -c \"import time; time.sleep(30)\""
    with pytest.raises(WorkspaceError) as caught:
        runner.run(repo.path, ["-c", f"alias.slow={slow}", "slow"], timeout=0.5)
    assert caught.value.code == "git_timeout"


def test_repository_filters_and_hooks_cannot_start_programs(runner, repo, marker_bench, oh_env):
    # A hostile repository: a smudge/clean/process filter bound to every file, and a post-checkout hook.
    repo.write(".gitattributes", "* filter=evil\n")
    repo.commit("a.txt", "data\n")
    repo.git("add", ".gitattributes")
    repo.git("commit", "-q", "-m", "attrs")
    repo.git("config", "filter.evil.smudge", marker_bench.command("smudge"))
    repo.git("config", "filter.evil.clean", marker_bench.command("clean"))
    repo.git("config", "filter.evil.process", marker_bench.command("process"))
    hook = repo.path / ".git" / "hooks" / "post-checkout"
    hook.write_text(f"#!/bin/sh\n{marker_bench.command('hook')}\n", encoding="utf-8", newline="\n")
    hook.chmod(0o755)
    repo.git("config", "core.fsmonitor", marker_bench.command("fsmonitor"))
    dest = oh_env.tmp / "checked-out"
    runner.run(repo.path, ["worktree", "add", "--detach", "--", str(dest), "HEAD"], filters=True)
    assert (dest / "a.txt").is_file()
    runner.run(dest, ["status", "--porcelain=v2", "-z"], filters=True)
    assert marker_bench.ran() == []


def test_filter_names_that_cannot_be_neutralized_fail_closed(runner, repo):
    # git refuses to even store such a key through the CLI; a raw config line is how a hostile repo carries one.
    with open(repo.path / ".git" / "config", "a", encoding="utf-8") as handle:
        handle.write('\n[filter "we=ird"]\n\tsmudge = evil\n')
    with pytest.raises(WorkspaceError) as caught:
        runner.run(repo.path, ["status", "--porcelain"], filters=True)
    assert caught.value.code == "unsafe_repository"


@pytest.mark.parametrize("ref", [
    "-x", "--force", "--upload-pack=touch pwned", "-", "--", "", " ", "a b", "a\tb", "a\nb", "a\x00b", "a\x7fb",
    "a..b", "a@{1}", "@{-1}", "a~1", "a^", "a:b", "a?b", "a*b", "a[b", "a\\b", "a//b", "/a", "a/", "a.", "a.lock",
    "x" * 300,
])
def test_hostile_or_malformed_refs_are_rejected(ref):
    with pytest.raises(WorkspaceError) as caught:
        validate_ref(ref)
    assert caught.value.code == "invalid_ref"


@pytest.mark.parametrize("ref", ["main", "v1.0", "origin/main", "refs/tags/v1", "HEAD", "0123abc", "feature/x-1", "ração/é"])
def test_ordinary_refs_pass_validation(ref):
    assert validate_ref(ref) == ref


@pytest.mark.parametrize("name", [
    "-x", "--force", "a;b", "a$(touch pwned)", "a`id`", "a|b", "a&b", "a>b", "a b", "a..b", "a@{u}", "HEAD", "refs/heads/x",
    "", "a.lock", "a/", "/a", ".hidden", "a\\b", "x" * 200,
])
def test_branch_names_are_a_strict_subset(name):
    with pytest.raises(WorkspaceError) as caught:
        validate_branch_name(name)
    assert caught.value.code == "invalid_branch"


@pytest.mark.parametrize("name", ["feature/x", "ws-1.2_3", "ração-é", "fix/ünï"])
def test_good_branch_names_pass(name):
    assert validate_branch_name(name) == name
