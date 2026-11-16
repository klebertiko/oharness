"""Provider catalogue — authoritative vendor specs for the sidecar.

Mirrors ``frontend/src/components/providers/catalog.ts``. Keep the two in step;
this module is authoritative at runtime. The frontend copy exists so the UI can
render a provider the user has not connected yet (and so the dev route runs
with no backend).
"""

from __future__ import annotations

from typing import Literal, TypedDict
from urllib.parse import urlsplit

ProviderId = Literal[
    "anthropic", "cursor", "openai", "ollama", "openrouter", "openai-compatible", "anthropic-gateway"
]
Residence = Literal["local", "cloud"]
Capability = Literal["chat", "agent", "embed"]
Billing = Literal["subscription", "credits", "metered", "none"]
Catalogue = Literal["fixed", "installed", "hosted", "routed", "agent-only"]


class CredentialSpec(TypedDict, total=False):
    # "cli" — no secret stored by this app at all; the connection rides
    # whatever session the vendor's own CLI is already logged into on this
    # machine (`claude login` / `cursor-agent login`). `where` names the login
    # command instead of a key-retrieval URL.
    kind: Literal["api-key", "cli", "none"]
    prefix: str
    where: str
    env: str


class EndpointSpec(TypedDict):
    default: str
    editable: bool


class ProviderSpec(TypedDict, total=False):
    id: ProviderId
    vendor: str
    monogram: str
    residence: Residence | Literal["either"]
    capabilities: list[Capability]
    billing: Billing
    catalogue: Catalogue
    credential: CredentialSpec
    endpoint: EndpointSpec
    summary: str
    caveat: str
    docs: str


PROVIDERS: dict[ProviderId, ProviderSpec] = {
    "anthropic": {
        "id": "anthropic",
        "vendor": "Anthropic",
        "monogram": "AN",
        "residence": "cloud",
        "capabilities": ["chat"],
        "billing": "subscription",
        "catalogue": "fixed",
        "credential": {
            "kind": "cli",
            "where": "Run `claude login` (or open Claude Code once and sign in).",
        },
        "endpoint": {"default": "https://api.anthropic.com", "editable": False},
        "summary": (
            "Claude models via the local `claude` CLI, non-interactive print mode. "
            "Runs on your Claude Pro/Max seat, not a metered API key."
        ),
        "caveat": (
            "Tool execution is disabled on every call (`--tools \"\"`) — this connection "
            "answers chat completions, it does not run commands or touch files."
        ),
        "docs": "https://docs.anthropic.com",
    },
    "cursor": {
        "id": "cursor",
        "vendor": "Cursor",
        "monogram": "CU",
        "residence": "cloud",
        "capabilities": ["agent"],
        "billing": "subscription",
        "catalogue": "agent-only",
        "credential": {
            "kind": "cli",
            "where": "Run `cursor-agent login` (or sign in once from the Cursor desktop app).",
        },
        "endpoint": {"default": "https://api.cursor.com", "editable": False},
        "summary": (
            "The headless `cursor-agent` CLI, non-interactive print mode. "
            "Runs on your Cursor seat, not a metered API key."
        ),
        "caveat": (
            "Cursor publishes no chat-completions endpoint — its CLI runs agents, "
            "not models. An LLM node cannot target this connection; a Delegate node can. "
            "Tool execution stays on for that delegated task (file/shell access), scoped "
            "to a pinned working directory."
        ),
        "docs": "https://cursor.com/docs/api",
    },
    "openai": {
        "id": "openai",
        "vendor": "OpenAI",
        "monogram": "OA",
        "residence": "cloud",
        "capabilities": ["chat", "embed"],
        "billing": "subscription",
        "catalogue": "fixed",
        "credential": {
            "kind": "cli",
            "where": "Run `codex login` (or open the Codex app once and sign in).",
        },
        "endpoint": {"default": "https://api.openai.com/v1", "editable": True},
        "summary": (
            "GPT models via the local `codex` CLI, non-interactive exec mode. "
            "Runs on your ChatGPT seat, not a metered API key."
        ),
        "caveat": (
            "Shell commands the model chooses to run go through a read-only "
            "sandbox (`--sandbox read-only`) and a pinned working directory — "
            "this connection answers chat completions, it does not write files."
        ),
        "docs": "https://platform.openai.com/docs",
    },
    "ollama": {
        "id": "ollama",
        "vendor": "Ollama",
        "monogram": "OL",
        "residence": "either",
        "capabilities": ["chat", "embed"],
        "billing": "none",
        "catalogue": "installed",
        "credential": {
            "kind": "none",
            "where": (
                "The local daemon is unauthenticated. "
                "Ollama Cloud is a separate connection."
            ),
            "env": "OLLAMA_API_KEY",
        },
        # /v1 is Ollama's OpenAI-compat surface — what every adapter call
        # (probe included) actually speaks; the bare daemon root 404s it.
        "endpoint": {"default": "http://127.0.0.1:11434/v1", "editable": True},
        "summary": "The daemon on this machine. Nothing leaves the device; nothing is billed.",
        "docs": "https://docs.ollama.com",
    },
    "openrouter": {
        "id": "openrouter",
        "vendor": "OpenRouter",
        "monogram": "OR",
        "residence": "cloud",
        "capabilities": ["chat"],
        "billing": "credits",
        "catalogue": "routed",
        "credential": {
            "kind": "api-key",
            "prefix": "sk-or-",
            "where": "openrouter.ai → Keys",
            "env": "OPENROUTER_API_KEY",
        },
        "endpoint": {"default": "https://openrouter.ai/api/v1", "editable": False},
        "summary": (
            "One key, many vendors. You pick a route — an ordered model preference — "
            "not a model."
        ),
        "caveat": (
            "Prices and availability are set by the upstream vendor and move without "
            "notice. A route with no fallback will fail when its first choice is down."
        ),
        "docs": "https://openrouter.ai/docs",
    },
}

OLLAMA_CLOUD: ProviderSpec = {
    **PROVIDERS["ollama"],
    "residence": "cloud",
    "billing": "subscription",
    "catalogue": "hosted",
    "credential": {
        "kind": "api-key",
        "prefix": "",
        "where": "ollama.com → Settings → API keys (or run `ollama signin`)",
        "env": "OLLAMA_API_KEY",
    },
    "endpoint": {"default": "https://ollama.com", "editable": False},
    "summary": (
        "ollama.com as a remote host — same API surface, models too large for this machine."
    ),
    "caveat": (
        "A cloud model id looks identical to a local one. The residence stamp on the "
        "row is the only thing that tells you where the tokens were computed."
    ),
}


# ── Connections a person creates (R-PRV-14, #402) ────────────────────────────
# Generic protocols, not vendors: the person names the connection (its own id)
# and points it at a server they chose. Both are `api-key` and metered, so the
# subscription ids (`anthropic`, `openai`, `cursor`) keep `kind=cli` (I13).
# The endpoint has no default: it is whatever the person typed, validated by
# `validate_custom_endpoint` before it is stored.
CUSTOM_PROVIDER_IDS: tuple[str, ...] = ("openai-compatible", "anthropic-gateway")

PROVIDERS["openai-compatible"] = {  # type: ignore[index]
    "id": "openai-compatible",
    "vendor": "OpenAI-compatible endpoint",
    "monogram": "OC",
    "residence": "either",
    "capabilities": ["chat"],
    "billing": "metered",
    "catalogue": "hosted",
    "credential": {"kind": "api-key", "prefix": "", "where": "The server's own settings", "env": ""},
    "endpoint": {"default": "", "editable": True},
    "summary": "Any server that speaks the OpenAI chat-completions API (vLLM, LM Studio, a company gateway).",
    "caveat": "The key goes only to the host you typed. Prices are unknown to this app.",
    "docs": "",
}

PROVIDERS["anthropic-gateway"] = {  # type: ignore[index]
    "id": "anthropic-gateway",
    "vendor": "Anthropic-compatible gateway",
    "monogram": "AG",
    "residence": "cloud",
    "capabilities": ["chat"],
    "billing": "metered",
    "catalogue": "hosted",
    "credential": {"kind": "api-key", "prefix": "", "where": "The gateway's own settings", "env": ""},
    "endpoint": {"default": "", "editable": True},
    "summary": "A gateway that speaks the Anthropic Messages API with an API key (not the Claude subscription).",
    "caveat": "The key goes only to the host you typed. Prices are unknown to this app.",
    "docs": "",
}


def is_custom_provider(provider_id: str) -> bool:
    return provider_id in CUSTOM_PROVIDER_IDS


def validate_custom_endpoint(endpoint: str) -> str | None:
    """Why a person-typed base URL is refused, or None when it is fine.

    http or https, a host, and nothing that carries a secret or changes where a
    request lands: no user/password, query or fragment, no whitespace or control
    characters. The reason never repeats the typed value (it may hold a token)."""
    if not endpoint:
        return "Enter the server's base URL."
    if any(ch.isspace() or ord(ch) < 0x20 or ord(ch) == 0x7F for ch in endpoint):
        return "The base URL cannot contain spaces or control characters."
    try:
        parts = urlsplit(endpoint)
        _ = parts.port  # raises on a malformed port
    except ValueError:
        return "The base URL is not a valid URL."
    if parts.scheme not in ("http", "https"):
        return "The base URL must start with http:// or https://."
    if not parts.hostname:
        return "The base URL needs a host."
    if "@" in parts.netloc:
        return "Put the key in the key field, not in the URL."
    if "?" in endpoint:
        return "The base URL cannot have a query string."
    if "#" in endpoint:
        return "The base URL cannot have a fragment."
    return None


def endpoint_origin(endpoint: str) -> tuple[str, str, int | None]:
    """(scheme, host, port): the part of a URL a stored key is bound to."""
    parts = urlsplit(endpoint)
    try:
        port = parts.port
    except ValueError:
        port = None
    return (parts.scheme.lower(), (parts.hostname or "").lower(), port)


def list_catalog() -> list[ProviderSpec]:
    """Return every base vendor spec (Ollama Cloud is a residence variant, not a row),
    then the generic protocols a person can create connections for."""
    ids = ("anthropic", "cursor", "openai", "ollama", "openrouter", *CUSTOM_PROVIDER_IDS)
    return [PROVIDERS[pid] for pid in ids]  # type: ignore[index]


def get_provider(provider_id: str) -> ProviderSpec | None:
    if provider_id in PROVIDERS:
        return PROVIDERS[provider_id]  # type: ignore[index]
    return None


def spec_for_connection(connection: dict) -> ProviderSpec | None:
    """The spec a stored connection really uses: an ``ollama`` row in the cloud
    is Ollama Cloud (an API key; "subscription" is only its billing), the same
    rule as the frontend's ``specForConnection``."""
    provider = connection.get("provider", "")
    if provider == "ollama" and connection.get("residence") == "cloud":
        return OLLAMA_CLOUD
    return get_provider(provider)


def endpoint_for_connection(connection: dict, spec: ProviderSpec) -> str:
    """Where calls for this connection go. A fixed endpoint is always the
    catalog default, so a stored key never reaches a host the row was edited to."""
    endpoint = spec.get("endpoint", {})
    if not endpoint.get("editable", True):
        return endpoint.get("default", "")
    return connection.get("endpoint") or endpoint.get("default", "")


# ── Per-model pricing ────────────────────────────────────────────────────────
# USD per million tokens, (input, output). Mirrors
# `frontend/src/components/providers/providerStore.ts`'s `seed` catalog
# exactly — same models, same numbers — because that file is the hand-
# maintained source of truth for real vendor prices, and the budget/cost
# engine (`backend/usage_tracking.py`) needs the same real numbers, not a
# second, drifting guess. A model absent here has *unknown* pricing to this
# backend, which is not the same as free: `usage_tracking.compute_cost`
# returns `(0.0, None)` for it, and callers must not read that `None` as
# "genuinely free" (that reading only holds for a local/on-device model,
# which naturally has no entry here either, distinguished by the caller via
# the connection's `residence`, not by anything in this table).
#
# Deliberately not populated for OpenAI or Ollama Cloud: nothing in this
# codebase has ever read a real price for either of those (no adapter probe
# populates `ModelInfo.price`, and the frontend seed carries none for them
# either) — inventing numbers here would be exactly the fabricated-price
# mistake this feature is required to avoid.
MODEL_PRICES: dict[str, tuple[float, float]] = {
    # Anthropic (direct)
    "claude-opus-5": (15, 75),
    "claude-sonnet-5": (3, 15),
    "claude-fable-5-1": (1, 5),
    "claude-haiku-4-5": (0.8, 4),
    # OpenRouter (routed — model ids carry the upstream vendor prefix)
    "anthropic/claude-opus-5": (15, 75),
    "openai/gpt-5-6-sol": (10, 40),
    "google/gemini-3-1-pro": (2.5, 12),
    "deepseek/deepseek-v4": (0.28, 1.1),
    "meta-llama/llama-4.2-405b": (0.9, 0.9),
    "qwen/qwen3.5-max": (1.2, 6),
    "mistralai/mistral-large-3": (2, 6),
    "x-ai/grok-4-6": (5, 15),
}


def get_model_price(model_id: str) -> tuple[float, float] | None:
    """USD per million tokens, (input, output) — or None when `model_id`'s
    price is not in the catalog (see `MODEL_PRICES`'s docstring for why that
    is never the same thing as "this model is free")."""
    return MODEL_PRICES.get(model_id)
