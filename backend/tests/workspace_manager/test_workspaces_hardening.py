"""Inputs that used to end in a 500 now end in a 4xx, and an ambiguous ref is refused instead of resolved silently."""
from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from main import app
from workspaces.errors import WorkspaceError


@pytest.fixture
def client(oh_env):
    return TestClient(app)


def test_a_token_with_non_ascii_digits_is_malformed_not_a_crash(svc, repo, wt):
    info, _ = wt
    for token in ("².abc", "٣٣.abc", "１２.abc", "1².abc"):
        with pytest.raises(WorkspaceError) as caught:
            svc.remove(str(repo.path), info["id"], token)
        assert caught.value.code == "confirmation_invalid" and caught.value.details["reason"] == "malformed"


def test_a_token_with_non_ascii_digits_over_http_is_a_409(client, repo, wt):
    info, _ = wt
    response = client.post(f"/workspaces/{info['id']}/remove", json={"repo": str(repo.path), "confirmation_token": "².abc"})
    assert response.status_code == 409 and response.json()["detail"]["code"] == "confirmation_invalid"


@pytest.mark.parametrize("suffix", ["::$DATA", ":stream", "::$INDEX_ALLOCATION"])
def test_a_repository_path_with_a_stream_suffix_is_a_400(client, repo, suffix):
    response = client.get("/workspaces", params={"repo": str(repo.path) + suffix})
    assert response.status_code == 400 and response.json()["detail"]["code"] == "invalid_repo"


@pytest.mark.parametrize("raw", [
    '{"repo": NaN, "ref": "main"}', '{"repo": "x", "ref": Infinity}', '{"repo": "x", "ref": "main", "branch": -Infinity}',
    '{"repo": "x", "ref": "main", "extra": NaN}',
])
def test_non_finite_numbers_in_a_body_are_a_422(client, raw):
    response = client.post("/workspaces", content=raw, headers={"Content-Type": "application/json"})
    assert response.status_code == 422


def test_non_finite_numbers_in_the_remove_body_are_a_422(client):
    raw = '{"repo": "x", "confirmation_token": "t", "release_lock": NaN}'
    response = client.post("/workspaces/main/remove", content=raw, headers={"Content-Type": "application/json"})
    assert response.status_code == 422


def test_ordinary_bodies_still_work(client, repo):
    outcome = client.post("/workspaces", json={"repo": str(repo.path), "ref": "main"})
    assert outcome.status_code == 201


def test_a_tag_and_a_branch_with_the_same_name_are_ambiguous(svc, repo):
    repo.git("tag", "dup")
    repo.commit("later.txt")
    repo.git("branch", "dup")
    with pytest.raises(WorkspaceError) as caught:
        svc.create(str(repo.path), "dup")
    assert caught.value.code == "ambiguous_ref" and caught.value.status == 409
    outcome = svc.create(str(repo.path), "refs/tags/dup")
    assert outcome["base_ref"] == "refs/tags/dup"  # fully qualified is unambiguous
    outcome = svc.create(str(repo.path), "refs/heads/dup")
    assert outcome["managed"]


def test_an_unambiguous_ref_is_unaffected(svc, repo):
    repo.git("tag", "v1")
    outcome = svc.create(str(repo.path), "v1")
    assert outcome["managed"]
    outcome = svc.create(str(repo.path), "main")
    assert outcome["managed"]


@pytest.mark.parametrize("raw", ['{"repo": 1e999, "ref": "main"}', '{"repo": "x", "ref": -1e999}', '{"repo": "x", "ref": "main", "extra": 1E400}'])
def test_a_number_too_large_for_a_float_is_a_422_not_a_500(client, raw):
    response = client.post("/workspaces", content=raw, headers={"Content-Type": "application/json"})
    assert response.status_code == 422


def test_finite_numbers_in_a_body_still_reach_validation(client):
    response = client.post("/workspaces", content='{"repo": 1.5, "ref": "main"}', headers={"Content-Type": "application/json"})
    assert response.status_code == 422 and response.json()["detail"][0]["type"] == "string_type"


def test_git_stderr_in_an_error_carries_no_absolute_path(client, oh_env):
    folder = oh_env.tmp / "not a repo"
    folder.mkdir()
    response = client.get("/workspaces", params={"repo": str(folder)})
    assert response.status_code == 400 and response.json()["detail"]["code"] == "not_a_repository"
    text = str(response.json())
    assert str(folder) not in text and folder.as_posix() not in text and "not a repo" not in text and str(oh_env.tmp) not in text


def test_a_failed_worktree_add_carries_no_absolute_path(svc, repo, oh_env, monkeypatch):
    original = svc.runner.run

    def failing(cwd, args, **kw):
        if args[:2] == ["worktree", "add"] or "add" in args and "worktree" in args:
            from workspaces.gitrun import GitFailure
            raise GitFailure(list(args), 128, f"fatal: '{oh_env.tmp.as_posix()}/some dir/x' already exists\nfatal: cannot lock ref 'refs/heads/x'")
        return original(cwd, args, **kw)

    monkeypatch.setattr(svc.runner, "run", failing)
    with pytest.raises(WorkspaceError) as caught:
        svc.create(str(repo.path), "main", branch="x")
    assert caught.value.code == "worktree_add_failed"
    text = str(caught.value.to_dict())
    assert str(oh_env.tmp) not in text and oh_env.tmp.as_posix() not in text and "some dir" not in text
    assert "refs/heads/x" in text  # ref names are not paths and stay readable


LONE_SURROGATE = '"' + chr(92) + 'ud800"'


@pytest.mark.parametrize("method,url,body", [
    ("post", "/workspaces", '{"repo": "x", "ref": %s}'),
    ("post", "/workspaces", '{"repo": %s, "ref": "main"}'),
    ("post", "/workspaces", '{"repo": "x", "ref": "main", "branch": %s}'),
    ("put", "/workspaces/selected", '{"repo": "x", "id": %s}'),
    ("post", "/workspaces/main/removal-check", '{"repo": %s}'),
    ("post", "/workspaces/main/remove", '{"repo": "x", "confirmation_token": %s}'),
    ("post", "/workspaces", '{"repo": "x", "ref": "main", %s: 1}'),
    ("post", "/workspaces", '{"repo": "x", "ref": "main", "extra": [{"deep": %s}]}'),
])
def test_a_lone_surrogate_in_a_body_is_a_422_not_a_500(client, method, url, body):
    response = getattr(client, method)(url, content=body % LONE_SURROGATE, headers={"Content-Type": "application/json"})
    assert response.status_code == 422 and response.json()["detail"]["code"] == "invalid_json"


def test_a_paired_surrogate_escape_is_a_character_not_an_error(client):
    response = client.post("/workspaces", content='{"repo": "x", "ref": "main", "branch": "' + chr(92) + 'ud83d' + chr(92) + 'ude00"}', headers={"Content-Type": "application/json"})
    assert response.status_code == 400 and response.json()["detail"]["code"] == "invalid_branch"  # the emoji is judged by the branch rules


@pytest.mark.parametrize("raw,expected", [
    ("fatal: C:" + chr(92) + "Program Files" + chr(92) + "My App" + chr(92) + "ws is not empty", "fatal: <path> is not empty"),
    ("fatal: /home/ana/my projects/repo/ws already exists", "fatal: <path> already exists"),
    ("fatal: 'feature/x' is not a valid branch", "fatal: 'feature/x' is not a valid branch"),
    ("fatal: cannot lock ref 'refs/heads/feature/x'", "fatal: cannot lock ref 'refs/heads/feature/x'"),
    ("fatal: '../sibling/dir' is outside", "fatal: '../sibling/dir' is outside"),
    ("fatal: 'C:/Users/a b/x' already exists", "fatal: '<path>' already exists"),
    ('fatal: "/home/u/my dir" already exists', 'fatal: "<path>" already exists'),
    ("error: a/b and then /abs/one failed", "error: a/b and then <path> failed"),
])
def test_scrub_paths_hides_absolute_paths_and_keeps_refs(raw, expected):
    from workspaces.errors import scrub_paths
    assert scrub_paths(raw) == expected


def nested(depth: int, leaf: str, as_object: bool) -> str:
    if as_object:
        return '{"repo": "x", "ref": "main", "extra": ' + '{"k": ' * depth + leaf + "}" * depth + "}"
    return '{"repo": "x", "ref": "main", "extra": ' + "[" * depth + leaf + "]" * depth + "}"


@pytest.mark.parametrize("as_object", [False, True], ids=["lists", "objects"])
@pytest.mark.parametrize("depth", [600, 1100, 5000])
def test_a_deeply_nested_body_is_never_a_500(client, depth, as_object):
    clean = client.post("/workspaces", content=nested(depth, "1", as_object), headers={"Content-Type": "application/json"})
    assert 400 <= clean.status_code < 500


def test_nesting_beyond_the_limit_is_a_422_and_the_limit_itself_is_still_judged_normally(client):
    deep = client.post("/workspaces", content=nested(101, "1", False), headers={"Content-Type": "application/json"})
    assert deep.status_code == 422 and deep.json()["detail"]["code"] == "invalid_json"
    within = client.post("/workspaces", content=nested(98, "1", False), headers={"Content-Type": "application/json"})
    assert within.status_code == 422 and within.json()["detail"] != deep.json()["detail"]  # the unknown field is reported by validation


@pytest.mark.parametrize("as_object", [False, True], ids=["lists", "objects"])
def test_a_lone_surrogate_at_the_bottom_of_a_deeply_nested_body_is_a_422(client, as_object):
    response = client.post("/workspaces", content=nested(600, LONE_SURROGATE, as_object), headers={"Content-Type": "application/json"})
    assert response.status_code == 422 and response.json()["detail"]["code"] == "invalid_json"
