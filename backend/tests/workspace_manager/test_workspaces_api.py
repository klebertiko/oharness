"""The /workspaces REST API: authentication, contracts, error codes and the full create-select-remove flow."""
from __future__ import annotations

import os
import threading
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from starlette.testclient import TestClient

from main import app

TOKEN = os.environ["OH_SIDECAR_TOKEN"]
ROUTES = [
    ("GET", "/workspaces?repo=x", None),
    ("POST", "/workspaces", {"repo": "x", "ref": "main"}),
    ("GET", "/workspaces/selected", None),
    ("PUT", "/workspaces/selected", {"repo": "x", "id": "main"}),
    ("DELETE", "/workspaces/selected", None),
    ("POST", "/workspaces/main/removal-check", {"repo": "x"}),
    ("POST", "/workspaces/main/remove", {"repo": "x", "confirmation_token": "t"}),
]


def raw_client() -> TestClient:
    # Not the auto-authenticated client from conftest: these tests control the Authorization header.
    client = TestClient(app)
    client.request = httpx.Client.request.__get__(client, TestClient)
    return client


@pytest.mark.parametrize("method,url,body", ROUTES)
def test_every_route_requires_the_sidecar_token(oh_env, method, url, body):
    send = getattr(raw_client(), method.lower())
    kwargs = {"json": body} if body is not None else {}
    assert send(url, **kwargs).status_code == 401
    assert send(url, headers={"Authorization": "Bearer wrong"}, **kwargs).status_code == 401
    assert send(url, headers={"Authorization": f"Bearer {TOKEN}"}, **kwargs).status_code != 401


@pytest.fixture
def client(oh_env):
    return TestClient(app)


def create(client, repo, **extra):
    return client.post("/workspaces", json={"repo": str(repo.path), "ref": "main", **extra})


def test_full_flow_create_list_select_check_remove(client, repo):
    made = create(client, repo, branch="feature/api")
    assert made.status_code == 201
    info = made.json()
    assert info["managed"] and info["branch"] == "feature/api" and info["id"].startswith("ws-")

    listed = client.get("/workspaces", params={"repo": str(repo.path)}).json()["workspaces"]
    assert [w["id"] for w in listed] == ["main", info["id"]]
    assert {w["id"]: w["state"] for w in listed} == {"main": "clean", info["id"]: "clean"}

    assert client.get("/workspaces/selected").json() == {"selected": None, "cwd": None, "stale": None}
    picked = client.put("/workspaces/selected", json={"repo": str(repo.path), "id": info["id"]})
    assert picked.status_code == 200 and picked.json()["cwd"] == info["path"]
    assert client.get("/workspaces/selected").json()["selected"]["id"] == info["id"]

    check = client.post(f"/workspaces/{info['id']}/removal-check", json={"repo": str(repo.path)}).json()
    assert check["removable"] and check["confirmation_token"] and not check["pending_work"]
    done = client.post(f"/workspaces/{info['id']}/remove", json={"repo": str(repo.path), "confirmation_token": check["confirmation_token"]})
    assert done.status_code == 200 and done.json()["removed"]
    assert client.get("/workspaces/selected").json()["selected"] is None
    assert [w["id"] for w in client.get("/workspaces", params={"repo": str(repo.path)}).json()["workspaces"]] == ["main"]


def test_dirty_removal_over_http_returns_the_rescue(client, repo):
    info = create(client, repo).json()
    with open(os.path.join(info["path"], "notes.txt"), "w", encoding="utf-8") as handle:
        handle.write("precious\n")
    check = client.post(f"/workspaces/{info['id']}/removal-check", json={"repo": str(repo.path)}).json()
    assert check["pending_work"] and check["will_preserve"] and check["changes"]["untracked"] == 1
    done = client.post(f"/workspaces/{info['id']}/remove", json={"repo": str(repo.path), "confirmation_token": check["confirmation_token"]}).json()
    assert done["rescue"]["ref"].startswith("refs/openharness/rescue/")
    assert repo.out("show", f"{done['rescue']['ref']}:notes.txt") == "precious"


def test_clearing_the_selection(client, repo):
    client.put("/workspaces/selected", json={"repo": str(repo.path), "id": "main"})
    outcome = client.delete("/workspaces/selected")
    assert outcome.status_code == 204
    assert client.get("/workspaces/selected").json()["selected"] is None


@pytest.mark.parametrize("ref,code,status", [("no-such-ref", "ref_not_found", 404), ("--upload-pack=x", "invalid_ref", 400), ("a b", "invalid_ref", 400)])
def test_ref_problems_map_to_stable_error_codes(client, repo, ref, code, status):
    response = client.post("/workspaces", json={"repo": str(repo.path), "ref": ref})
    assert response.status_code == status and response.json()["detail"]["code"] == code


def test_the_client_cannot_choose_a_destination(client, repo, oh_env):
    smuggled = oh_env.tmp / "chosen-by-client"
    response = client.post("/workspaces", json={"repo": str(repo.path), "ref": "main", "path": str(smuggled)})
    assert response.status_code == 422 and not smuggled.exists()
    response = client.post("/workspaces", json={"repo": str(repo.path), "ref": "main", "destination": str(smuggled)})
    assert response.status_code == 422 and not smuggled.exists()


def test_validation_and_lookup_errors(client, repo, oh_env):
    assert client.get("/workspaces").status_code == 422
    assert client.get("/workspaces", params={"repo": "relative"}).json()["detail"]["code"] == "invalid_repo"
    assert client.get("/workspaces", params={"repo": str(oh_env.tmp)}).json()["detail"]["code"] == "not_a_repository"
    missing = client.post("/workspaces/ws-0000000000000000/removal-check", json={"repo": str(repo.path)})
    assert missing.status_code == 404 and missing.json()["detail"]["code"] == "workspace_not_found"
    outcome = client.put("/workspaces/selected", json={"repo": str(repo.path), "id": "nope"})
    assert outcome.status_code == 404
    outcome = client.post("/workspaces/main/remove", json={"repo": str(repo.path)})
    assert outcome.status_code == 422


def test_protected_and_stale_removals_map_to_403_and_409(client, repo):
    protected = client.post("/workspaces/main/remove", json={"repo": str(repo.path), "confirmation_token": "x"})
    assert protected.status_code == 403 and protected.json()["detail"]["code"] == "protected_workspace"
    info = create(client, repo).json()
    check = client.post(f"/workspaces/{info['id']}/removal-check", json={"repo": str(repo.path)}).json()
    with open(os.path.join(info["path"], "late.txt"), "w", encoding="utf-8") as handle:
        handle.write("changed after the check\n")
    stale = client.post(f"/workspaces/{info['id']}/remove", json={"repo": str(repo.path), "confirmation_token": check["confirmation_token"]})
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "confirmation_invalid"
    assert os.path.isfile(os.path.join(info["path"], "late.txt"))


def test_concurrent_creates_over_http(client, repo):
    barrier = threading.Barrier(3)

    def attempt(_):
        barrier.wait()
        return create(client, repo)

    with ThreadPoolExecutor(3) as pool:
        responses = list(pool.map(attempt, range(3)))
    assert [r.status_code for r in responses] == [201, 201, 201]
    assert len({r.json()["id"] for r in responses}) == 3
    assert len(client.get("/workspaces", params={"repo": str(repo.path)}).json()["workspaces"]) == 4
