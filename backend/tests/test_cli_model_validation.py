"""#401 / R-PRV-09: a typed model reaches the CLI argv only after validation.

A subscription connection (credential.kind=cli) lets the user type any model, and
that text becomes the value of ``--model`` in the CLI's argv. It is checked first:
letters, digits, dot, hyphen, underscore, colon and slash only; it cannot start
with "-"; its length is capped. An empty model keeps the CLI's own default.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from adapters.base import AdapterConfig
from adapters.cli_claude import ClaudeCliAdapter
from adapters.cli_codex import CodexCliAdapter
from adapters.cli_cursor import CursorCliAdapter
from adapters.cli_shared import CLI_MODEL_MAX_LEN, valid_cli_model
from main import app
from providers.resolution import ProviderResolutionError, resolve_node_provider
from secret_store.memory import MemorySecrets

ADAPTERS = [("claude", ClaudeCliAdapter), ("codex", CodexCliAdapter), ("cursor", CursorCliAdapter)]
GOOD = ["sonnet", "opus", "claude-sonnet-4-5", "gpt-5.1-codex", "qwen3:8b", "openai/gpt-5", "a_b"]
BAD = ["--x", "-m", "has space", "a;b", "a$(b)", "a\nb", "", "x" * (CLI_MODEL_MAX_LEN + 1)]


@pytest.mark.parametrize("model", GOOD)
def test_valid_cli_model_accepts_cli_aliases_and_ids(model: str) -> None:
    assert valid_cli_model(model)


@pytest.mark.parametrize("model", BAD)
def test_valid_cli_model_rejects_flags_spaces_and_shell_text(model: str) -> None:
    assert not valid_cli_model(model)


@pytest.mark.parametrize(("adapter", "cls"), ADAPTERS)
@pytest.mark.parametrize("model", ["--x", "has space", "a;b"])
def test_build_argv_refuses_an_invalid_model(adapter: str, cls: type, model: str) -> None:
    with pytest.raises(ValueError) as caught:
        cls().build_argv(AdapterConfig(adapter=adapter, model=model))
    assert model not in str(caught.value)  # fixed text, never the typed value


@pytest.mark.parametrize(("adapter", "cls"), ADAPTERS)
def test_build_argv_passes_a_valid_model_after_the_flag(adapter: str, cls: type) -> None:
    argv = cls().build_argv(AdapterConfig(adapter=adapter, model="sonnet"))
    assert argv[argv.index("--model") + 1] == "sonnet"


@pytest.mark.parametrize(("adapter", "cls"), ADAPTERS)
def test_empty_model_keeps_the_cli_default(adapter: str, cls: type) -> None:
    assert "--model" not in cls().build_argv(AdapterConfig(adapter=adapter, model=""))


def _anthropic(model: str) -> dict:
    return {"anthropic": {"id": "anthropic", "provider": "anthropic", "label": "Claude", "residence": "cloud",
                          "endpoint": "", "enabled": True, "secretRef": None, "defaultModel": model}}


def test_resolution_rejects_an_invalid_subscription_model() -> None:
    with pytest.raises(ProviderResolutionError, match="model"):
        resolve_node_provider({"providerIds": ["anthropic"]}, "llm", "Draft",
                              connections=_anthropic("--x"), secrets_store=MemorySecrets())


def test_resolution_rejects_an_invalid_node_model_on_a_subscription() -> None:
    with pytest.raises(ProviderResolutionError, match="model"):
        resolve_node_provider({"providerIds": ["anthropic"], "model": "a;b"}, "llm", "Draft",
                              connections=_anthropic(""), secrets_store=MemorySecrets())


def test_resolution_keeps_a_valid_subscription_model() -> None:
    resolved = resolve_node_provider({"providerIds": ["anthropic"]}, "llm", "Draft",
                                     connections=_anthropic("opus"), secrets_store=MemorySecrets())
    assert resolved.config.model == "opus"


@pytest.fixture()
def client():
    connections: dict = {}
    with TestClient(app) as c:
        app.state.secrets_store = MemorySecrets()
        app.state.provider_connections = connections
        yield c


@pytest.mark.parametrize("model", ["--x", "has space", "a;b"])
def test_api_refuses_an_invalid_model_on_a_subscription_connection(client: TestClient, model: str) -> None:
    created = client.post("/providers/connections", json={
        "id": "anthropic", "provider": "anthropic", "label": "Claude", "defaultModel": model})
    assert created.status_code == 400
    assert model not in created.text
    client.post("/providers/connections", json={"id": "anthropic", "provider": "anthropic", "label": "Claude"})
    updated = client.put("/providers/connections/anthropic", json={"defaultModel": model})
    assert updated.status_code == 400
    assert client.get("/providers/connections/anthropic").json()["defaultModel"] == ""


def test_api_accepts_a_typed_model_and_an_empty_one(client: TestClient) -> None:
    client.post("/providers/connections", json={"id": "openai", "provider": "openai", "label": "ChatGPT"})
    assert client.put("/providers/connections/openai", json={"defaultModel": "gpt-5.1-codex"}).status_code == 200
    assert client.put("/providers/connections/openai", json={"defaultModel": ""}).status_code == 200
