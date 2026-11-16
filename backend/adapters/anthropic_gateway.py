"""Anthropic Messages API over a person-chosen gateway, with an API key (#402).

This is the metered path. The Claude subscription keeps riding the `claude` CLI
(`cli_claude.py`, I13); nothing here reads `ANTHROPIC_API_KEY` or any CLI
session. The base URL is the connection's endpoint, already validated by
`catalog.validate_custom_endpoint`; requests go to `{base}/v1/messages` and the
probe to `{base}/v1/models`, which costs no tokens.
"""
from __future__ import annotations

import json
import time
from typing import AsyncIterator

import httpx

from .base import AdapterConfig, AdapterResult, AgentAdapter, ProbeResult
from .openai_compatible import MAX_MODEL_ID_LEN, MAX_PROBE_BODY_BYTES, MAX_PROBE_MODELS

ANTHROPIC_VERSION = "2023-06-01"
TIMEOUT = httpx.Timeout(120.0, connect=10.0)
PROBE_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


def _base(config: AdapterConfig) -> str:
    base = (config.endpoint or "").rstrip("/")
    # Accept a base typed with or without the version segment.
    return base[: -len("/v1")] if base.endswith("/v1") else base


def _headers(config: AdapterConfig) -> dict[str, str]:
    headers = {"anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json"}
    if config.api_key:
        headers["x-api-key"] = config.api_key
    return headers


def _usage_tokens(usage: object) -> int | None:
    if not isinstance(usage, dict):
        return None
    parts = [usage.get("input_tokens"), usage.get("output_tokens")]
    ints = [p for p in parts if isinstance(p, int) and not isinstance(p, bool)]
    return sum(ints) if ints else None


class AnthropicGatewayAdapter(AgentAdapter):
    def __init__(self, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        # Injectable so tests assert on the real request without a network.
        self._transport = transport

    def _client(self, timeout: httpx.Timeout) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=timeout, transport=self._transport)

    async def _call(self, prompt: str, config: AdapterConfig) -> tuple[str, int | None, str]:
        payload: dict = {
            "model": config.model,
            "max_tokens": config.max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        if config.system_prompt:
            payload["system"] = config.system_prompt
        async with self._client(TIMEOUT) as client:
            resp = await client.post(f"{_base(config)}/v1/messages", json=payload, headers=_headers(config))
        if resp.status_code >= 400:
            # Fixed text: the body may echo request headers.
            raise RuntimeError(f"HTTP {resp.status_code} from the gateway.")
        try:
            body = resp.json()
        except ValueError as exc:
            raise RuntimeError("The gateway answered with something that is not JSON.") from exc
        if not isinstance(body, dict):
            raise RuntimeError("The gateway answered with an unexpected shape.")
        blocks = body.get("content") or []
        text = "".join(
            b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text"
        )
        model = body.get("model") if isinstance(body.get("model"), str) else config.model
        return text, _usage_tokens(body.get("usage")), model

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        text, tokens, model = await self._call(prompt, config)
        return AdapterResult(content=text, tokens_used=tokens or 0, model=model)

    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        text, _tokens, _model = await self._call(prompt, config)
        yield text

    async def stream_events(self, prompt: str, config: AdapterConfig) -> AsyncIterator[dict]:
        yield {"kind": "phase", "phase": "writing", "detail": config.model or config.adapter}
        text, tokens, _model = await self._call(prompt, config)
        yield {"kind": "text", "text": text}
        if tokens is not None:
            yield {"kind": "usage", "tokens": tokens}

    async def probe(self, config: AdapterConfig) -> ProbeResult:
        base = _base(config)
        if not base:
            return ProbeResult(ok=False, health="setup", detail="Set the gateway's base URL first.")
        started = time.monotonic()
        raw = b""
        try:
            async with self._client(PROBE_TIMEOUT) as client:
                async with client.stream("GET", f"{base}/v1/models", headers=_headers(config)) as resp:
                    status = resp.status_code
                    async for chunk in resp.aiter_bytes():
                        raw += chunk
                        if len(raw) > MAX_PROBE_BODY_BYTES:
                            return ProbeResult(
                                ok=False, health="degraded", detail="The gateway sent a model list larger than 2 MB."
                            )
        except httpx.TimeoutException:
            return ProbeResult(ok=False, health="fault", detail="The gateway did not respond in time.", code="timeout")
        except httpx.HTTPError:
            return ProbeResult(ok=False, health="fault", detail="Could not reach the gateway.", code="error")
        latency = max(1, int((time.monotonic() - started) * 1000))
        if status in (401, 403):
            return ProbeResult(
                ok=False, health="setup", detail="The gateway refused the key. Check it and save it again.",
                latency_ms=latency, code="error",
            )
        if status >= 400:
            return ProbeResult(ok=False, health="fault", detail=f"HTTP {status} from the gateway.", latency_ms=latency, code="error")
        models: list[str] = []
        try:
            body = json.loads(raw)
            data = body.get("data") if isinstance(body, dict) else None
            for item in (data if isinstance(data, list) else [])[:MAX_PROBE_MODELS]:
                mid = item.get("id") if isinstance(item, dict) else None
                if isinstance(mid, str) and 0 < len(mid) <= MAX_MODEL_ID_LEN:
                    models.append(mid)
        except ValueError:
            pass
        return ProbeResult(
            ok=True, health="live", detail="The gateway answered and accepted the key.",
            latency_ms=latency, models=models,
        )
