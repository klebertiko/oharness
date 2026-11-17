from .base import AgentAdapter, AdapterConfig, AdapterResult
from .openai_compatible import OpenAICompatibleAdapter
from .cli_claude import ClaudeCliAdapter
from .cli_codex import CodexCliAdapter
from .cli_cursor import CursorCliAdapter
from .mock import MockAdapter
from .anthropic_gateway import AnthropicGatewayAdapter


def get_adapter(adapter_name: str) -> AgentAdapter:
    # "claude", "cursor" and "codex" ride each vendor's own authenticated CLI
    # session (Claude Pro/Max, Cursor Pro, ChatGPT) rather than a metered API
    # key — see cli_claude.py / cli_cursor.py / cli_codex.py.
    # `adapters.claude.ClaudeAdapter` (the direct Anthropic-SDK, metered path)
    # still exists but is intentionally not wired in here; ollama/openrouter
    # keep their standard API-key/local flow unchanged.
    adapters = {
        "ollama": OpenAICompatibleAdapter(),
        "lmstudio": OpenAICompatibleAdapter(),
        # OpenRouter speaks the same OpenAI-compatible chat-completions shape;
        # the real distinction is the endpoint + key a connection carries.
        "openrouter": OpenAICompatibleAdapter(),
        # Metered API-key path — kept resolvable by this literal key for any
        # caller that asks for it directly; the "openai" *connection*
        # (ADAPTER_BY_PROVIDER in providers/resolution.py) now maps to
        # "codex" instead, riding the ChatGPT subscription like claude/cursor.
        "openai": OpenAICompatibleAdapter(),
        "claude": ClaudeCliAdapter(),
        "cursor": CursorCliAdapter(),
        "codex": CodexCliAdapter(),
        # Metered Anthropic Messages API over a gateway the person chose (#402);
        # the subscription stays on "claude" (I13).
        "anthropic-gateway": AnthropicGatewayAdapter(),
        "mock": MockAdapter(),
    }
    return adapters.get(adapter_name, MockAdapter())
