from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator


@dataclass
class AdapterConfig:
    adapter: str
    model: str
    endpoint: str = ""
    api_key: str = ""
    system_prompt: str = ""
    temperature: float = 0.7
    max_tokens: int = 4096
    extra: dict = field(default_factory=dict)


@dataclass
class AdapterResult:
    content: str
    tokens_used: int = 0
    model: str = ""
    error: str = ""


@dataclass
class ModelInfo:
    """One selectable model. `price` is USD per million tokens, (in, out)."""

    id: str
    ctx: int = 0
    price: tuple[float, float] | None = None
    via: str = ""          # upstream vendor — routed providers only
    size: str = ""         # on-disk size — local providers only


@dataclass
class ProbeResult:
    """
    Outcome of a reachability + credential check.

    Deliberately separate from AdapterResult: a probe must never need a prompt,
    must never spend tokens, and must return something renderable even when the
    connection is broken. `detail` is written for a person to act on — one
    sentence, no stack traces — because it is the string the dossier shows.
    """

    ok: bool
    health: str = "fault"          # live | setup | degraded | fault
    detail: str = ""
    latency_ms: int = 0
    # (key, value, tone) triples surfaced in the dossier's Account block.
    facts: list[tuple[str, str, str]] = field(default_factory=list)
    # Model ids the endpoint itself reported serving (OpenAI-compatible
    # `GET /models`). Empty when the adapter has no such listing (CLI
    # adapters) — the UI then falls back to its catalog, labelled as such.
    models: list[str] = field(default_factory=list)
    # Machine-readable reason when `ok` is False, so callers need not parse
    # `detail`: not_installed | not_logged_in | platform_unsupported | timeout | error.
    code: str = ""


class AgentAdapter(ABC):
    @abstractmethod
    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        """Single-shot invocation — returns complete response."""

    @abstractmethod
    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        """Streaming invocation — yields text chunks."""

    async def stream_events(
        self, prompt: str, config: AdapterConfig
    ) -> AsyncIterator[dict]:
        """
        Structured streaming — yields dicts the engine translates into SSE.

        Recognised shapes:
            {"kind": "phase",       "phase": str, "detail": str}
            {"kind": "reason",      "text": str}
            {"kind": "text",        "text": str}
            {"kind": "tool_call",   "call_id": str, "name": str, "args": str}
            {"kind": "tool_result", "call_id": str, "ok": bool,
                                    "result": str, "duration_ms": int}
            {"kind": "usage",       "tokens": int}

        The default implementation lifts a plain text stream into this shape, so
        an adapter that only knows how to emit tokens keeps working unchanged
        and simply never reports reasoning or tool use.
        """
        yield {"kind": "phase", "phase": "writing", "detail": config.model or config.adapter}
        async for chunk in self.stream(prompt, config):
            yield {"kind": "text", "text": chunk}

    async def probe(self, config: AdapterConfig) -> ProbeResult:
        """
        Check that this connection is usable, without spending tokens.

        Concrete by design rather than abstract: adding a probe must not break
        an adapter that has not implemented one yet. The default answer is an
        honest "we do not know", never a fabricated success.
        """
        return ProbeResult(
            ok=False,
            health="setup",
            detail=f"The {config.adapter} adapter does not implement a probe yet.",
        )
