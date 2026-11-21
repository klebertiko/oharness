"""Plan, catalog parity, and advanced options."""
from __future__ import annotations

import re
from pathlib import Path

from fastapi.testclient import TestClient

from adapters.catalog import PROVIDERS
from main import app
from providers.advanced import validate_advanced
from providers.plan import enumerated_plan

ROOT = Path(__file__).resolve().parents[2]
FRONTEND_CATALOG = ROOT / "frontend" / "src" / "components" / "providers" / "catalog.ts"
GUIDES = ROOT / "docs" / "guides" / "providers"


def test_plan_is_an_enumerated_word_and_an_address_is_not() -> None:
    assert enumerated_plan("max") == "Max"
    assert enumerated_plan(" Pro ") == "Pro"
    assert enumerated_plan("canary-person@example.test") is None
    assert enumerated_plan("plus plan") is None
    assert enumerated_plan(None) is None


def test_frontend_catalog_matches_backend_ids_and_credential_kinds() -> None:
    text = FRONTEND_CATALOG.read_text(encoding="utf-8")
    ids = re.findall(r'\n  (?:"([\w-]+)"|(\w+)): \{\n    id: "([\w-]+)"', text)
    found = {item[2]: None for item in ids}
    kinds = dict(re.findall(r'id: "([\w-]+)"[\s\S]*?kind: "([\w-]+)"', text))
    assert set(kinds) == set(PROVIDERS)
    for provider_id, spec in PROVIDERS.items():
        assert kinds[provider_id] == spec["credential"]["kind"]
    assert found  # the objects were parsed
    cli = [pid for pid, spec in PROVIDERS.items() if spec["credential"]["kind"] == "cli"]
    assert cli == ["anthropic", "cursor", "openai"]


def test_each_provider_has_a_setup_guide_and_only_that_folder_is_exempt() -> None:
    names = {path.stem for path in GUIDES.glob("*.md")}
    assert set(PROVIDERS) <= names


def test_advanced_rejects_a_bad_value_without_echoing_it() -> None:
    clean, error = validate_advanced({"retryPolicy": "nope", "note": "canary-person@example.test"})
    assert clean is None and error
    assert "canary" not in error and "@" not in error
    ok, err = validate_advanced({
        "retryPolicy": "transient",
        "retryCap": 3,
        "allowlist": ["sonnet"],
        "models": {"sonnet": {"displayName": "Everyday", "context": 200000, "maxOutput": 8192}},
    })
    assert err is None and ok is not None
    assert ok["models"]["sonnet"]["displayName"] == "Everyday"


def test_advanced_route_keeps_a_rejected_save_as_an_error(client=None) -> None:
    with TestClient(app) as http:
        created = http.post("/providers/connections", json={
            "id": "xai-work", "provider": "xai", "label": "Work", "residence": "cloud",
            "endpoint": "https://api.x.ai/v1", "enabled": False, "defaultModel": "",
        })
        assert created.status_code == 201
        bad = http.put("/providers/connections/xai-work/advanced", json={"retryPolicy": "nope", "secret": "sk-test"})
        assert bad.status_code == 400
        assert "sk-test" not in bad.text and "@" not in bad.text
        good = http.put("/providers/connections/xai-work/advanced", json={"retryPolicy": "all", "retryCap": 1, "allowlist": [], "models": {}})
        assert good.status_code == 200
        assert http.get("/providers/connections/xai-work/advanced").json()["retryPolicy"] == "all"
