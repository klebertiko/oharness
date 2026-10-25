"""Bundled example harnesses: catalog, validity, round-trip and packaging.

The app ships ready-to-use example harnesses next to the default Agile one.
Each must validate, plan a complete mock run, round-trip through the OHM
codec unchanged, be listed by the examples catalog/API, and be packaged for
the desktop build (Tauri resource + PyInstaller sidecar data).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from main import app
from oharness import codec, examples
from oharness.mock_run import plan_mock_run
from oharness.models import HarnessBundle
from oharness.validate import validate_path

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent
TAURI_DIR = REPO_ROOT / "src-tauri"

EXPECTED = {
    "oharness.default.agile": None,
    "oharness.example.deepseek-harness": "https://github.com/deepseek-ai/deepseek-harness",
    "oharness.example.mattpocock-skills": "https://github.com/mattpocock/skills",
}
NEW_IDS = [i for i, url in EXPECTED.items() if url]

client = TestClient(app)


def _entry(example_id: str) -> examples.Example:
    return next(e for e in examples.list_examples() if e.id == example_id)


def test_catalog_lists_default_and_new_examples_in_order():
    assert [e.id for e in examples.list_examples()] == list(EXPECTED)


@pytest.mark.parametrize("example_id", list(EXPECTED))
def test_example_fixture_validates_and_matches_its_id(example_id):
    entry = _entry(example_id)
    result = validate_path(entry.path)
    assert result.ok, result.errors
    assert codec.load_path(entry.path)["manifest"]["id"] == example_id


@pytest.mark.parametrize("example_id", NEW_IDS)
def test_new_example_round_trips_through_codec(example_id):
    path = _entry(example_id).path
    loaded = codec.load_path(path)
    assert codec.encode(loaded) == path.read_bytes()
    assert codec.load_bytes(codec.encode(loaded)) == loaded


@pytest.mark.parametrize("example_id", NEW_IDS)
def test_new_example_plans_a_complete_mock_run(example_id):
    bundle = HarnessBundle.model_validate(codec.load_path(_entry(example_id).path))
    report = plan_mock_run(bundle)
    assert report.ok
    assert len(report.steps) == len(bundle.graph.nodes) >= 8
    assert all(step.status == "planned" for step in report.steps)


@pytest.mark.parametrize("example_id", NEW_IDS)
def test_new_example_cites_source_and_ships_no_secrets(example_id):
    data = codec.load_path(_entry(example_id).path)
    assert EXPECTED[example_id] in data["manifest"]["description"]
    assert data["runtime"]["secrets"] == []
    for node in data["graph"]["nodes"]:
        node_data = node.get("data", {})
        assert "apiKey" not in node_data
        # Providers are left for the user to choose in the app.
        assert node_data.get("providerIds", []) == []
    assert data["content"]["agents"], "agent profiles must be authored"
    assert data["content"]["skills"], "skills must be authored"
    # The OHarness assistant is Nilo; examples never call it "Copilot".
    assert "copilot" not in _entry(example_id).path.read_text(encoding="utf-8").lower()


def test_examples_endpoint_lists_full_bundles():
    r = client.get("/bundles/examples")
    assert r.status_code == 200
    items = r.json()["examples"]
    assert [i["id"] for i in items] == list(EXPECTED)
    for item in items:
        assert item["name"] and item["description"]
        assert item["bundle"]["manifest"]["id"] == item["id"]
        ok = client.post("/bundles/validate", json=item["bundle"]).json()
        assert ok == {"ok": True, "errors": []}


@pytest.mark.parametrize("example_id", list(EXPECTED))
def test_example_endpoint_returns_one_bundle(example_id):
    r = client.get(f"/bundles/examples/{example_id}")
    assert r.status_code == 200
    assert r.json() == codec.load_path(_entry(example_id).path)


def test_example_endpoint_unknown_id_is_404():
    assert client.get("/bundles/examples/nope").status_code == 404


@pytest.mark.parametrize("example_id", NEW_IDS)
def test_new_example_is_packaged_for_desktop(example_id):
    entry = _entry(example_id)
    conf = json.loads((TAURI_DIR / "tauri.conf.json").read_text(encoding="utf-8"))
    resource = f"resources/{entry.path.stem}.oharness"
    assert resource in conf["bundle"]["resources"]
    assert codec.load_path(TAURI_DIR / resource) == codec.load_path(entry.path)
    sidecar = (REPO_ROOT / "scripts" / "build-sidecar.mjs").read_text(encoding="utf-8")
    assert f'"{entry.path.name}"' in sidecar
