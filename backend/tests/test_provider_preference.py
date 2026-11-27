"""Two accounts of the same family coexist, and failover follows the preference order."""
from __future__ import annotations

from secret_store.memory import MemorySecrets
from providers.preference import order_for_failover
from providers.resolution import resolve_node_provider_with_failover


def _accounts() -> dict:
    return {
        "anthropic": {
            "id": "anthropic", "provider": "anthropic", "label": "Pessoal",
            "residence": "cloud", "endpoint": "https://api.anthropic.com", "enabled": True, "defaultModel": "",
        },
        "anthropic-work": {
            "id": "anthropic-work", "provider": "anthropic-gateway", "label": "Empresa",
            "residence": "cloud", "endpoint": "https://gateway.example.test", "enabled": True,
            "secretRef": "work", "defaultModel": "claude-sonnet",
        },
    }


def test_order_puts_the_preferred_account_first() -> None:
    assert order_for_failover(
        ["anthropic", "anthropic-work"],
        ["anthropic-work", "anthropic"],
    ) == ["anthropic-work", "anthropic"]


def test_two_anthropic_accounts_coexist_and_the_engine_follows_the_order() -> None:
    connections = _accounts()
    secrets = MemorySecrets()
    secrets.put("work", "sk-test-value")
    preference = ["anthropic-work", "anthropic"]
    requested = ["anthropic", "anthropic-work"]
    resolved, attempts = resolve_node_provider_with_failover(
        {"providerIds": requested, "preference": preference},
        "llm", "draft", connections=connections, secrets_store=secrets,
    )
    assert {row["provider"] for row in connections.values()} == {"anthropic", "anthropic-gateway"}
    assert resolved.connection_id == "anthropic-work"
    assert resolved.connection_label == "Empresa"
    assert attempts == []

    connections["anthropic-work"]["enabled"] = False
    resolved, attempts = resolve_node_provider_with_failover(
        {"providerIds": requested, "preference": preference},
        "llm", "draft", connections=connections, secrets_store=secrets,
    )
    assert [item.connection_id for item in attempts] == ["anthropic-work"]
    assert resolved.connection_id == "anthropic"
    assert resolved.connection_label == "Pessoal"
