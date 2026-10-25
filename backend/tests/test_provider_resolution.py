"""
Effective-provider resolution for a graph node — the honest-precedence rule:

  1. Node override — `data["providerIds"][0]`, a connection id. The frontend
     is the single writer of this field: it carries a genuine per-node pin
     when the author set one, or the chat chip's connection id filled in as
     a fallback when the node carries none of its own. The backend only
     ever sees one concrete id per node — it does not re-implement the
     chip-fallback choice.
  2. Anything that keeps that id from running a real turn (missing,
     unknown, disabled, uncredentialed, or a provider that cannot serve
     this node type) is a `ProviderResolutionError` — never a silent
     MockAdapter substitution.
"""
from __future__ import annotations

import pytest

from adapters.cli_claude import ClaudeCliAdapter
from adapters.openai_compatible import OpenAICompatibleAdapter
from providers.resolution import (
    ProviderResolutionError,
    resolve_node_provider,
    resolve_node_provider_with_failover,
)
from secret_store.memory import MemorySecrets


def _connections(**overrides: dict) -> dict[str, dict]:
    base = {
        "anthropic": {
            "id": "anthropic",
            "provider": "anthropic",
            "label": "Anthropic",
            "residence": "cloud",
            "endpoint": "https://api.anthropic.com",
            "enabled": True,
            "secretRef": "oharness/anthropic",  # gitleaks:allow
        },
        "ollama-local": {
            "id": "ollama-local",
            "provider": "ollama",
            "label": "Ollama local",
            "residence": "local",
            "endpoint": "http://127.0.0.1:11434",
            "enabled": True,
            "secretRef": None,
            "defaultModel": "qwen3.8:27b",
        },
        "cursor": {
            "id": "cursor",
            "provider": "cursor",
            "label": "Cursor",
            "residence": "cloud",
            "endpoint": "https://api.cursor.com",
            "enabled": True,
            "secretRef": "oharness/cursor",
        },
        "openrouter": {
            "id": "openrouter",
            "provider": "openrouter",
            "label": "OpenRouter",
            "residence": "cloud",
            "endpoint": "https://openrouter.ai/api/v1",
            "enabled": True,
            "secretRef": "oharness/openrouter",
            "defaultModel": "anthropic/claude-opus-5",
        },
    }
    base.update(overrides)
    return base


def _store_with(*refs: tuple[str, str]) -> MemorySecrets:
    store = MemorySecrets()
    for ref, value in refs:
        store.put(ref, value)
    return store


def test_no_provider_ids_is_an_honest_error() -> None:
    with pytest.raises(ProviderResolutionError, match="[Pp]rovider"):
        resolve_node_provider(
            {}, "llm", "Draft", connections=_connections(), secrets_store=MemorySecrets()
        )


def test_empty_provider_ids_list_is_an_honest_error() -> None:
    with pytest.raises(ProviderResolutionError):
        resolve_node_provider(
            {"providerIds": []},
            "llm",
            "Draft",
            connections=_connections(),
            secrets_store=MemorySecrets(),
        )


def test_unknown_connection_id_is_an_honest_error() -> None:
    with pytest.raises(ProviderResolutionError, match="ghost"):
        resolve_node_provider(
            {"providerIds": ["ghost"]},
            "llm",
            "Draft",
            connections=_connections(),
            secrets_store=MemorySecrets(),
        )


def test_http_adapter_with_no_default_model_is_an_honest_error() -> None:
    # Ollama's own OpenAI-compat surface 400s with "model is required" when
    # this stays empty (confirmed live, 2026-09-11) — resolve_node_provider
    # must catch it before the adapter does, with an actionable message
    # instead of a raw httpx error repeated once per harness node.
    conns = _connections()
    conns["ollama-local"]["defaultModel"] = ""
    with pytest.raises(ProviderResolutionError, match="no default model"):
        resolve_node_provider(
            {"providerIds": ["ollama-local"]},
            "llm",
            "Draft",
            connections=conns,
            secrets_store=MemorySecrets(),
        )


def test_node_pinned_model_satisfies_the_http_adapter_requirement_alone() -> None:
    conns = _connections()
    conns["ollama-local"]["defaultModel"] = ""
    resolved = resolve_node_provider(
        {"providerIds": ["ollama-local"], "model": "gemma4:26b"},
        "llm",
        "Draft",
        connections=conns,
        secrets_store=MemorySecrets(),
    )
    assert resolved.config.model == "gemma4:26b"


def test_disabled_connection_is_an_honest_error() -> None:
    conns = _connections()
    conns["anthropic"]["enabled"] = False
    with pytest.raises(ProviderResolutionError, match="Anthropic"):
        resolve_node_provider(
            {"providerIds": ["anthropic"]},
            "llm",
            "Draft",
            connections=conns,
            secrets_store=MemorySecrets(),
        )


def test_missing_secret_ref_is_an_honest_error() -> None:
    # Anthropic/Cursor ride the CLI's own login (credential.kind: "cli") and
    # need no secretRef at all — see test_anthropic_connection_resolves_to_
    # claude_cli_adapter_without_a_credential below. OpenRouter still carries
    # a real api-key credential, so it's the one that should still enforce
    # this.
    conns = _connections()
    conns["openrouter"]["secretRef"] = None
    with pytest.raises(ProviderResolutionError, match="credential"):
        resolve_node_provider(
            {"providerIds": ["openrouter"]},
            "llm",
            "Draft",
            connections=conns,
            secrets_store=MemorySecrets(),
        )


def test_secret_ref_absent_from_vault_is_an_honest_error() -> None:
    with pytest.raises(ProviderResolutionError, match="vault"):
        resolve_node_provider(
            {"providerIds": ["openrouter"]},
            "llm",
            "Draft",
            connections=_connections(),
            secrets_store=MemorySecrets(),  # never populated
        )


def test_cursor_connection_on_an_llm_node_is_an_honest_error() -> None:
    """Cursor is agent-only (see catalog caveat) — it cannot serve an LLM node."""
    with pytest.raises(ProviderResolutionError, match="Cursor|chat"):
        resolve_node_provider(
            {"providerIds": ["cursor"]},
            "llm",
            "Draft",
            connections=_connections(),
            secrets_store=_store_with(("oharness/cursor", "crsr_x")),
        )


def test_anthropic_connection_resolves_to_claude_cli_adapter_without_a_credential() -> None:
    # Anthropic rides the `claude` CLI's own subscription login (catalog
    # credential.kind: "cli", see adapters/catalog.py) — no secretRef is
    # required or read, unlike the old metered-API-key model this test used
    # to assert. A connection with no secretRef at all must still resolve.
    conns = _connections()
    conns["anthropic"]["secretRef"] = None
    resolved = resolve_node_provider(
        {"providerIds": ["anthropic"], "model": "claude-sonnet-5"},
        "llm",
        "Draft",
        connections=conns,
        secrets_store=MemorySecrets(),
    )
    assert resolved.adapter_name == "claude"
    assert isinstance(resolved.adapter, ClaudeCliAdapter)
    assert resolved.config.api_key == ""
    assert resolved.config.model == "claude-sonnet-5"
    assert resolved.config.endpoint == "https://api.anthropic.com"
    assert resolved.connection_id == "anthropic"
    assert resolved.connection_label == "Anthropic"


def test_ollama_local_connection_needs_no_credential() -> None:
    resolved = resolve_node_provider(
        {"providerIds": ["ollama-local"]},
        "llm",
        "Draft",
        connections=_connections(),
        secrets_store=MemorySecrets(),
    )
    assert resolved.adapter_name == "ollama"
    assert isinstance(resolved.adapter, OpenAICompatibleAdapter)
    assert resolved.config.api_key == ""


def test_openrouter_connection_resolves_to_openai_compatible_adapter() -> None:
    resolved = resolve_node_provider(
        {"providerIds": ["openrouter"]},
        "llm",
        "Draft",
        connections=_connections(),
        secrets_store=_store_with(("oharness/openrouter", "sk-or-REAL")),
    )
    assert resolved.adapter_name == "openrouter"
    assert isinstance(resolved.adapter, OpenAICompatibleAdapter)
    assert resolved.config.api_key == "sk-or-REAL"
    assert resolved.config.endpoint == "https://openrouter.ai/api/v1"


def test_second_provider_id_is_never_consulted_when_first_is_usable() -> None:
    """`providerIds` is ordered primary-then-fallbacks; a usable primary wins outright."""
    resolved = resolve_node_provider(
        {"providerIds": ["anthropic", "ollama-local"]},
        "llm",
        "Draft",
        connections=_connections(),
        secrets_store=_store_with(("oharness/anthropic", "sk-ant-REAL-KEY")),
    )
    assert resolved.connection_id == "anthropic"


def test_cwd_is_carried_into_extra_as_both_cwd_and_cwd_root() -> None:
    # `cli_shared.resolve_cwd` treats `extra["cwd_root"]` as the containment
    # boundary for `extra["cwd"]` — the caller here (engine.py) has already
    # validated this path against the cowork_projects table, so both keys
    # get the same value: the validated project directory IS its own root.
    resolved = resolve_node_provider(
        {"providerIds": ["anthropic"]},
        "llm",
        "Draft",
        connections=_connections(),
        secrets_store=MemorySecrets(),
        cwd="D:\\Development\\src\\OHarness",
    )
    assert resolved.config.extra["cwd"] == "D:\\Development\\src\\OHarness"
    assert resolved.config.extra["cwd_root"] == "D:\\Development\\src\\OHarness"


def test_no_cwd_means_extra_has_no_cwd_keys_at_all() -> None:
    # Not merely `None` -- absent. A CLI adapter reads `extra.get("cwd")`,
    # for which a missing key and an explicit `None` behave identically, but
    # keeping the "no folder chosen" case free of the keys entirely is the
    # more honest shape: this config was never told about a working folder.
    resolved = resolve_node_provider(
        {"providerIds": ["anthropic"]},
        "llm",
        "Draft",
        connections=_connections(),
        secrets_store=MemorySecrets(),
    )
    assert "cwd" not in resolved.config.extra
    assert "cwd_root" not in resolved.config.extra


# ── PROVIDER-FAILOVER AC#1 — resolve_node_provider_with_failover ───────────────
# `providerIds = [A, B]`, A fails to *resolve* (disabled/unknown/missing
# credential) -> walks the order and resolves on B instead of raising.


def test_disabled_first_id_fails_over_to_second_resolvable_id() -> None:
    conns = _connections()
    conns["anthropic"]["enabled"] = False
    resolved, attempts = resolve_node_provider_with_failover(
        {"providerIds": ["anthropic", "ollama-local"]},
        "llm",
        "Draft",
        connections=conns,
        secrets_store=MemorySecrets(),
    )
    assert resolved.connection_id == "ollama-local"
    assert [a.connection_id for a in attempts] == ["anthropic"]
    assert "Anthropic" in attempts[0].reason


def test_unknown_first_id_fails_over_to_second_resolvable_id() -> None:
    resolved, attempts = resolve_node_provider_with_failover(
        {"providerIds": ["ghost", "ollama-local"]},
        "llm",
        "Draft",
        connections=_connections(),
        secrets_store=MemorySecrets(),
    )
    assert resolved.connection_id == "ollama-local"
    assert [a.connection_id for a in attempts] == ["ghost"]


def test_missing_credential_first_id_fails_over_to_second_resolvable_id() -> None:
    conns = _connections()
    conns["openrouter"]["secretRef"] = None
    resolved, attempts = resolve_node_provider_with_failover(
        {"providerIds": ["openrouter", "ollama-local"]},
        "llm",
        "Draft",
        connections=conns,
        secrets_store=MemorySecrets(),
    )
    assert resolved.connection_id == "ollama-local"
    assert [a.connection_id for a in attempts] == ["openrouter"]


def test_first_id_usable_means_no_attempts_recorded_not_a_failover() -> None:
    """A plain pin (no fallback consulted) must not look like a failover — AC#4's
    distinguishability guarantee starts here: `attempts` must be empty."""
    resolved, attempts = resolve_node_provider_with_failover(
        {"providerIds": ["anthropic", "ollama-local"]},
        "llm",
        "Draft",
        connections=_connections(),
        secrets_store=_store_with(("oharness/anthropic", "sk-ant-REAL")),
    )
    assert resolved.connection_id == "anthropic"
    assert attempts == []


def test_all_ids_unresolvable_raises_the_last_ones_honest_error() -> None:
    conns = _connections()
    conns["anthropic"]["enabled"] = False
    with pytest.raises(ProviderResolutionError, match="ghost"):
        resolve_node_provider_with_failover(
            {"providerIds": ["anthropic", "ghost"]},
            "llm",
            "Draft",
            connections=conns,
            secrets_store=MemorySecrets(),
        )


def test_single_id_behaves_byte_for_byte_like_resolve_node_provider_ac6() -> None:
    conns = _connections()
    conns["anthropic"]["enabled"] = False
    try:
        resolve_node_provider(
            {"providerIds": ["anthropic"]}, "llm", "Draft",
            connections=conns, secrets_store=MemorySecrets(),
        )
        assert False, "expected ProviderResolutionError"
    except ProviderResolutionError as legacy_exc:
        legacy_message = str(legacy_exc)

    with pytest.raises(ProviderResolutionError) as excinfo:
        resolve_node_provider_with_failover(
            {"providerIds": ["anthropic"]}, "llm", "Draft",
            connections=conns, secrets_store=MemorySecrets(),
        )
    assert str(excinfo.value) == legacy_message


def test_empty_provider_ids_list_is_still_an_honest_error() -> None:
    with pytest.raises(ProviderResolutionError):
        resolve_node_provider_with_failover(
            {"providerIds": []}, "llm", "Draft",
            connections=_connections(), secrets_store=MemorySecrets(),
        )
