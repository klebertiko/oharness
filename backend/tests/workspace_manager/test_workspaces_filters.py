"""A repository's own filter drivers must not run on any path that reads a worktree, removal included.

Removal no longer calls ``git worktree remove`` (the manager deletes the worktree and its administrative directory itself), so no
``git status`` child runs there; the commands that still read a tree (status, add, ls-files, worktree add, the create rollback) are
neutralised on the call itself, and the tests below prove each one with a sentinel that a filter would write.
"""
from __future__ import annotations

from pathlib import Path

import pytest


FILTER_NAMES = ["evil", "A.B.c", 'q"uote', "ünï", "has#hash", "semi;colon", "sp ace"]
TREE_READING = {"status", "add", "diff", "checkout", "switch", "restore", "reset", "stash", "clean", "ls-files", "merge", "apply"}
WORKTREE_READING = {"add", "remove", "prune", "repair", "move"}


def hostile_repo(repo, marker_bench, name):
    repo.write(".gitattributes", f"* filter={name}\n")
    repo.git("add", ".gitattributes")
    repo.git("commit", "-q", "-m", "attrs")
    for var in ("clean", "smudge", "process"):
        repo.git("config", f"filter.{name}.{var}", marker_bench.command(var))


def touch_all(path: Path):
    """Same bytes, new mtime: git can no longer trust its index stat data and must run the clean filter to compare content."""
    for name in ("README.md", ".gitattributes"):
        target = path / name
        target.write_bytes(target.read_bytes())


@pytest.mark.parametrize("name", FILTER_NAMES)
def test_removing_a_clean_worktree_runs_no_repository_filter(svc, repo, marker_bench, name):
    hostile_repo(repo, marker_bench, name)
    info = svc.create(str(repo.path), "main", branch="clean")
    assert marker_bench.ran() == []
    touch_all(Path(info["path"]))
    report = svc.removal_check(str(repo.path), info["id"])
    assert report["removable"]
    svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert marker_bench.ran() == [] and not Path(info["path"]).exists()


@pytest.mark.parametrize("name", FILTER_NAMES)
def test_removing_a_dirty_worktree_runs_no_repository_filter(svc, repo, marker_bench, name):
    hostile_repo(repo, marker_bench, name)
    info = svc.create(str(repo.path), "main", branch="dirty")
    path = Path(info["path"])
    touch_all(path)
    (path / "README.md").write_text("changed\n", encoding="utf-8")
    (path / "new.txt").write_text("untracked\n", encoding="utf-8")
    report = svc.removal_check(str(repo.path), info["id"])
    result = svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert marker_bench.ran() == [] and result["rescue"]["ref"]
    assert repo.out("show", f"{result['rescue']['ref']}:new.txt") == "untracked"


def test_every_git_call_that_reads_a_worktree_neutralises_filters(svc, repo, marker_bench, monkeypatch):
    hostile_repo(repo, marker_bench, "evil")
    calls: list[tuple[list[str], bool]] = []
    original = svc.runner.run

    def spy(cwd, args, **kw):
        calls.append((list(args), bool(kw.get("filters"))))
        return original(cwd, args, **kw)

    monkeypatch.setattr(svc.runner, "run", spy)
    info = svc.create(str(repo.path), "main", branch="audit")
    path = Path(info["path"])
    (path / "README.md").write_text("changed\n", encoding="utf-8")
    (path / "new.txt").write_text("x\n", encoding="utf-8")
    svc.list(str(repo.path))
    report = svc.removal_check(str(repo.path), info["id"])
    svc.remove(str(repo.path), info["id"], report["confirmation_token"])

    # a create that fails after `worktree add` must roll back through a filter-neutralised call too
    def boom(change):
        raise RuntimeError("store down")

    monkeypatch.setattr(svc.store, "mutate", boom)
    with pytest.raises(RuntimeError):
        svc.create(str(repo.path), "main", branch="rolled-back")

    def subcommand(args):
        rest = list(args)
        while rest[:1] == ["-c"]:
            rest = rest[2:]
        return rest

    offenders = []
    for args, filtered in calls:
        rest = subcommand(args)
        reads = rest[0] in TREE_READING or (rest[0] == "worktree" and rest[1] in WORKTREE_READING)
        if reads and not filtered:
            offenders.append(rest[:3])
    assert offenders == []
    assert any(subcommand(a)[:2] == ["worktree", "remove"] for a, _ in calls)
    assert marker_bench.ran() == []


# ----------------------------------------------------------------------- a filter driver with an EMPTY name (`[filter ""]`, `filter=`)


def empty_name_repo(repo, marker_bench):
    """`.gitattributes` says ``filter=`` (empty value) and the configuration defines ``[filter ""]``: key ``filter..clean``."""
    repo.write(".gitattributes", "*.w filter=\n")
    repo.write("a.w", "payload\n")
    repo.git("add", ".gitattributes", "a.w")
    repo.git("commit", "-q", "-m", "attrs")
    for var in ("clean", "smudge", "process"):
        repo.git("config", f"filter..{var}", marker_bench.command(var))


def test_the_empty_driver_name_is_neutralised_by_the_runner(runner, repo, marker_bench):
    empty_name_repo(repo, marker_bench)
    (repo.path / "a.w").write_text("changed\n", encoding="utf-8")
    repo.write("b.w", "new\n")
    runner.run(repo.path, ["status", "--porcelain=v2", "-z", "--untracked-files=all"], filters=True)
    runner.run(repo.path, ["add", "--all"], filters=True)
    assert marker_bench.ran() == []


def test_creating_a_workspace_runs_no_empty_name_filter(svc, repo, marker_bench):
    empty_name_repo(repo, marker_bench)
    info = svc.create(str(repo.path), "main", branch="empty-create")
    assert marker_bench.ran() == [] and Path(info["path"]).is_dir()


def test_list_and_status_run_no_empty_name_filter(svc, repo, marker_bench):
    empty_name_repo(repo, marker_bench)
    info = svc.create(str(repo.path), "main", branch="empty-list")
    path = Path(info["path"])
    svc.list(str(repo.path))  # clean
    touch_stat = path / "a.w"
    touch_stat.write_bytes(touch_stat.read_bytes())
    svc.list(str(repo.path))
    (path / "a.w").write_text("changed\n", encoding="utf-8")
    (path / "n.w").write_text("untracked\n", encoding="utf-8")
    svc.list(str(repo.path))  # dirty
    svc.removal_check(str(repo.path), info["id"])
    assert marker_bench.ran() == []


def test_removing_a_clean_worktree_runs_no_empty_name_filter(svc, repo, marker_bench):
    empty_name_repo(repo, marker_bench)
    info = svc.create(str(repo.path), "main", branch="empty-clean")
    target = Path(info["path"]) / "a.w"
    target.write_bytes(target.read_bytes())
    report = svc.removal_check(str(repo.path), info["id"])
    svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert marker_bench.ran() == [] and not Path(info["path"]).exists()


def test_removing_a_dirty_worktree_runs_no_empty_name_filter(svc, repo, marker_bench):
    empty_name_repo(repo, marker_bench)
    info = svc.create(str(repo.path), "main", branch="empty-dirty")
    path = Path(info["path"])
    (path / "a.w").write_text("changed\n", encoding="utf-8")
    (path / "n.w").write_text("untracked\n", encoding="utf-8")
    report = svc.removal_check(str(repo.path), info["id"])
    result = svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert marker_bench.ran() == [] and result["rescue"]["ref"]
    assert repo.out("show", f"{result['rescue']['ref']}:n.w") == "untracked"


# ----------------------------------------------------------------------- a filter driver whose NAME cannot be neutralised exactly (fail closed):
# not valid UTF-8, or containing "=" or a control character (it cannot be written back into a ``-c`` argument unchanged)

from workspaces.errors import WorkspaceError  # noqa: E402

BAD_NAMES = {"lone-ff": b"\xff", "truncated": b"a\xc3(b", "latin1": b"caf\xe9", "overlong": b"\xc0\xaf", "surrogate": b"\xed\xa0\x80",
             "equals": b"a=b", "control-01": b"a\x01b", "tab": b"a\tb", "control-1f": b"a\x1fb"}


def bytes_name_repo(repo, marker_bench, name: bytes):
    """A tracked ``a.w`` plus a filter driver named ``name``."""
    repo.commit("a.w", "payload\n")
    plant_bytes_filter(repo, marker_bench, name)


def plant_bytes_filter(repo, marker_bench, name: bytes):
    """Define the driver and attach it to ``*.w``, writing the raw bytes straight into the files (no argv can carry them)."""
    git_dir = repo.path / ".git"
    commands = b"".join(b"\t" + var.encode() + b" = " + marker_bench.command(var).replace("\\", "\\\\").replace('"', '\\"').encode() + b"\n"
                        for var in ("clean", "smudge", "process"))
    with open(git_dir / "config", "ab") as handle:
        handle.write(b'[filter "' + name + b'"]\n' + commands)
    (git_dir / "info").mkdir(exist_ok=True)
    with open(git_dir / "info" / "attributes", "ab") as handle:
        handle.write(b"*.w filter=" + name + b"\n")


@pytest.fixture(params=sorted(BAD_NAMES))
def bad_name(request):
    return BAD_NAMES[request.param]


def test_a_filter_driver_name_that_cannot_be_neutralised_is_refused_by_the_runner(runner, repo, marker_bench, bad_name):
    bytes_name_repo(repo, marker_bench, bad_name)
    (repo.path / "a.w").write_text("changed\n", encoding="utf-8")
    with pytest.raises(WorkspaceError) as caught:
        runner.run(repo.path, ["add", "--all"], filters=True)
    assert caught.value.code == "unsafe_repository" and marker_bench.ran() == []


def test_creating_a_workspace_in_a_repository_with_an_unneutralisable_filter_runs_nothing(svc, repo, marker_bench, bad_name):
    bytes_name_repo(repo, marker_bench, bad_name)
    with pytest.raises(WorkspaceError) as caught:
        svc.create(str(repo.path), "main", branch="bad-create")
    assert caught.value.code == "unsafe_repository" and marker_bench.ran() == []
    assert svc.list(str(repo.path))[0]["kind"] == "main" and len(svc.list(str(repo.path))) == 1
    assert repo.out("branch", "--list", "bad-create") == ""


def test_listing_with_an_unneutralisable_filter_runs_nothing(svc, repo, marker_bench, bad_name):
    repo.commit("a.w", "payload\n")
    info = svc.create(str(repo.path), "main", branch="bad-list")
    plant_bytes_filter(repo, marker_bench, bad_name)
    path = Path(info["path"])
    svc.list(str(repo.path))  # clean
    target = path / "a.w"
    target.write_bytes(target.read_bytes())
    svc.list(str(repo.path))  # same bytes, new mtime
    target.write_text("changed\n", encoding="utf-8")
    (path / "n.w").write_text("untracked\n", encoding="utf-8")
    svc.list(str(repo.path))  # dirty
    assert marker_bench.ran() == []


@pytest.mark.parametrize("dirty", [False, True], ids=["clean", "dirty"])
def test_removing_with_a_non_utf8_filter_runs_nothing(svc, repo, marker_bench, bad_name, dirty):
    repo.commit("a.w", "payload\n")
    info = svc.create(str(repo.path), "main", branch="bad-remove")
    path = Path(info["path"])
    if dirty:
        (path / "a.w").write_text("changed\n", encoding="utf-8")
        (path / "n.w").write_text("untracked\n", encoding="utf-8")
    report = svc.removal_check(str(repo.path), info["id"])
    plant_bytes_filter(repo, marker_bench, bad_name)  # planted after the confirmation was issued
    target = path / "a.w"
    if not dirty:
        target.write_bytes(target.read_bytes())
    with pytest.raises(WorkspaceError):
        svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert marker_bench.ran() == [] and path.is_dir()


# ----------------------------------------------------------------------- a filter defined only in the TARGET worktree's config.worktree


def worktree_only_filter(repo, marker_bench, info):
    """``extensions.worktreeConfig`` on, the driver set with ``git config --worktree`` from inside the workspace: it is in
    ``<common>/worktrees/<id>/config.worktree``, which the principal worktree's configuration does not contain."""
    repo.git("config", "extensions.worktreeConfig", "true")
    for var in ("clean", "smudge", "process"):
        repo.git("config", "--worktree", f"filter.ev.{var}", marker_bench.command(var), cwd=info["path"])


def worktree_filter_repo(repo, marker_bench):
    repo.write(".gitattributes", "*.w filter=ev\n")
    repo.commit("a.w", "payload\n")
    repo.git("add", ".gitattributes")
    repo.git("commit", "-q", "-m", "attrs")


@pytest.mark.parametrize("dirty", [False, True], ids=["clean", "dirty"])
def test_a_filter_only_in_the_target_worktrees_config_runs_nothing_on_removal(svc, repo, marker_bench, dirty):
    worktree_filter_repo(repo, marker_bench)
    info = svc.create(str(repo.path), "main", branch="wtcfg")
    worktree_only_filter(repo, marker_bench, info)
    path = Path(info["path"])
    target = path / "a.w"
    target.write_bytes(target.read_bytes())  # new mtime: git must compare content to know the file is unchanged
    if dirty:
        (path / "n.w").write_text("untracked\n", encoding="utf-8")
    report = svc.removal_check(str(repo.path), info["id"])
    assert report["removable"]
    svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert marker_bench.ran() == [] and not path.exists()


def stale_worktree(svc, repo, marker_bench, branch):
    """A clean worktree whose only filter is in its own config.worktree and whose tracked file has a new mtime: a plain
    ``git worktree remove`` (no ``--force``) starts a ``git status`` there that must run the clean filter to compare content."""
    worktree_filter_repo(repo, marker_bench)
    info = svc.create(str(repo.path), "main", branch=branch)
    worktree_only_filter(repo, marker_bench, info)
    path = Path(info["path"])
    target = path / "a.w"
    target.write_bytes(target.read_bytes())
    return path


def test_the_unneutralised_worktree_remove_does_run_the_filter(runner, svc, repo, marker_bench):
    """Positive control for the two tests below: without neutralisation the sentinel fires, so an empty sentinel there means something."""
    path = stale_worktree(svc, repo, marker_bench, "control")
    runner.run(repo.path, ["worktree", "remove", "--", str(path)], filters=False, check=False)
    assert marker_bench.ran() != []


def test_the_runner_unions_the_configuration_of_other_worktrees(runner, svc, repo, marker_bench):
    path = stale_worktree(svc, repo, marker_bench, "union")
    runner.run(repo.path, ["worktree", "remove", "--", str(path)], filters=True, filter_dirs=[path])
    assert marker_bench.ran() == [] and not path.exists()



def test_a_configuration_that_changed_while_git_ran_discards_the_result(repo, runner, monkeypatch):
    """The drivers are read before git runs; if they differ afterwards the filter set that was blanked was not the one in force."""
    from workspaces.errors import WorkspaceError

    seen = iter([{"first"}, {"first", "planted"}])
    monkeypatch.setattr(runner, "_filter_neutralisers", lambda cwd: next(seen))
    with pytest.raises(WorkspaceError) as caught:
        runner.run(repo.path, ["status", "--porcelain"], filters=True)
    assert caught.value.code == "config_changed" and caught.value.status == 409


def test_an_unchanged_configuration_keeps_the_result(repo, runner):
    assert runner.run(repo.path, ["status", "--porcelain"], filters=True).returncode == 0
