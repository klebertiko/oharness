"""The managed root: where worktrees may live, and the proof that a destination stays inside it."""
from __future__ import annotations

import os
import sys

import pytest

from workspaces.errors import WorkspaceError
from workspaces.paths import ManagedRoot, new_workspace_id, repo_dir_name, valid_workspace_id


def make_junction(link, target):
    """A directory junction (Windows, no privilege needed) or a symlink; skip when neither can be made."""
    if sys.platform == "win32":
        import _winapi
        _winapi.CreateJunction(str(target), str(link))
        return
    try:
        os.symlink(target, link, target_is_directory=True)
    except OSError:
        pytest.skip("cannot create links here")


@pytest.fixture
def root(tmp_path):
    managed = tmp_path / "managed"
    managed.mkdir()
    return ManagedRoot(managed)


def test_ids_are_generated_and_validated():
    ident = new_workspace_id()
    assert valid_workspace_id(ident) and ident.startswith("ws-") and len(ident) == 19
    assert new_workspace_id() != ident


@pytest.mark.parametrize("bad", ["", "ws-", "ws-XYZ", "../ws-0123456789abcdef", "ws-0123456789abcdef/x", "NUL", "ws-0123456789abcde", "ws-0123456789abcdeff", "main"])
def test_malformed_ids_are_not_valid(bad):
    assert not valid_workspace_id(bad)


def test_repo_dir_is_stable_safe_and_distinct(tmp_path):
    first = repo_dir_name(tmp_path / "A" / ".git")
    assert first == repo_dir_name(tmp_path / "A" / ".git")
    assert first != repo_dir_name(tmp_path / "B" / ".git")
    weird = repo_dir_name(tmp_path / "CON" / ".git")
    assert all(ch.isalnum() or ch in "-_." for ch in weird) and not weird.upper().startswith("CON.")


def test_destination_is_built_by_the_server_under_the_root(root):
    ident = new_workspace_id()
    dest = root.destination("proj-abc123", ident)
    assert dest == (root.path / "proj-abc123" / ident)
    assert dest.is_relative_to(root.path)


@pytest.mark.parametrize("name", ["CON", "con", "NUL", "aux", "COM1", "com9", "LPT1", "lpt9", "con.txt", "NUL.log", "name.", "name ", "a:b", "a<b", 'a"b', "a|b", "a?b", "a*b", "..", ".", "", "a/b", "a\\b", "x" * 120])
def test_unsafe_directory_names_are_refused(root, name):
    with pytest.raises(WorkspaceError) as caught:
        root.destination(name, "ws-0123456789abcdef")
    assert caught.value.code == "unsafe_destination"


def test_an_id_that_is_not_a_generated_id_is_refused(root):
    with pytest.raises(WorkspaceError) as caught:
        root.destination("proj-abc123", "../../escape")
    assert caught.value.code == "unsafe_destination"


@pytest.mark.parametrize("raw", ["\\\\server\\share\\wt", "//server/share/wt", "\\\\?\\C:\\wt", "\\\\.\\C:\\wt"])
def test_unc_and_device_roots_are_refused(raw):
    with pytest.raises(WorkspaceError) as caught:
        ManagedRoot.from_path(raw)
    assert caught.value.code == "unsafe_destination"


def test_a_link_between_the_root_and_the_destination_is_refused(root, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    make_junction(root.path / "proj-abc123", outside)
    with pytest.raises(WorkspaceError) as caught:
        root.destination("proj-abc123", new_workspace_id())
    assert caught.value.code == "unsafe_destination"
    assert list(outside.iterdir()) == []


def test_a_destination_that_already_exists_is_a_collision(root):
    ident = new_workspace_id()
    (root.path / "proj-abc123" / ident).mkdir(parents=True)
    with pytest.raises(WorkspaceError) as caught:
        root.destination("proj-abc123", ident)
    assert caught.value.code == "id_collision" and caught.value.status == 409


def test_a_destination_that_is_itself_a_link_is_a_collision_not_a_target(root, tmp_path):
    ident = new_workspace_id()
    outside = tmp_path / "outside2"
    outside.mkdir()
    (root.path / "proj-abc123").mkdir()
    make_junction(root.path / "proj-abc123" / ident, outside)
    with pytest.raises(WorkspaceError) as caught:
        root.destination("proj-abc123", ident)
    assert caught.value.code in {"id_collision", "unsafe_destination"}


def test_overlong_paths_are_refused(tmp_path):
    deep = tmp_path / ("d" * 40) / ("e" * 40) / ("f" * 40) / ("g" * 40) / ("h" * 40)
    with pytest.raises(WorkspaceError) as caught:
        ManagedRoot(deep).destination("proj-abc123", new_workspace_id())
    assert caught.value.code == "unsafe_destination"


def test_is_managed_path_is_exact_containment(root, tmp_path):
    inside = root.path / "proj-abc123" / "ws-0123456789abcdef"
    inside.mkdir(parents=True)
    assert root.owns(inside)
    assert not root.owns(root.path)
    assert not root.owns(tmp_path / "elsewhere")
    assert not root.owns(root.path.parent / (root.path.name + "-sibling") / "x")
