"""Every provider failure class has a stable code, i18n keys, and one primary action."""
from __future__ import annotations

import pytest

from providers.errors import PROVIDER_ERROR_CODES, classify_provider_error, provider_error_catalog

# One input per class, so a missing row fails this table.
CASES = [
    ("authentication", {"status": 401}),
    ("authentication", {"status": 403}),
    ("cli_missing", {"cli": "cli-missing"}),
    ("cli_signed_out", {"cli": "cli-signin"}),
    ("usage_limit", {"cli": "usage_limit"}),
    ("http_429", {"status": 429}),
    ("overload", {"status": 503}),
    ("overload", {"status": 529}),
    ("timeout", {"cli": "cli-timeout"}),
    ("model_not_found", {"signal": "model_not_found"}),
    ("model_not_pulled", {"signal": "model_not_pulled"}),
    ("endpoint_unreachable", {"wire": "transport"}),
    ("content_policy", {"signal": "content_policy"}),
    ("budget_exceeded", {"signal": "budget_exceeded"}),
]


def test_the_catalog_has_every_class_exactly_once() -> None:
    catalog = provider_error_catalog()
    assert tuple(catalog) == PROVIDER_ERROR_CODES
    assert len(PROVIDER_ERROR_CODES) == len(set(PROVIDER_ERROR_CODES)) == 12
    seen_actions = set()
    for code, row in catalog.items():
        assert row["code"] == code
        assert row["what_key"] == f"providers.error.{code}.what"
        assert row["why_key"] == f"providers.error.{code}.why"
        assert row["action_key"] == f"providers.error.{code}.action"
        assert row["action"]
        assert " " not in row["action"]
        assert row["wire"]
        seen_actions.add(row["action"])
    assert seen_actions  # every class named an action
    # HTTP 429 is its own row and is reported as the usage-limit class.
    assert catalog["http_429"]["wire"] == "usage_limit"
    assert catalog["usage_limit"]["wire"] == "usage_limit"


@pytest.mark.parametrize(("code", "kwargs"), CASES)
def test_every_class_is_reached_by_a_closed_input(code: str, kwargs: dict) -> None:
    assert classify_provider_error(**kwargs) == code


def test_unknown_input_is_not_forced_into_a_nearby_class() -> None:
    assert classify_provider_error(status=500) is None
    assert classify_provider_error(cli="cli-error") is None
    assert classify_provider_error(signal="usage limit reached at 6:20") is None
    assert classify_provider_error() is None
