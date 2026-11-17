"""Claude adapter against a mocked Messages API (guards the anthropic 2.x SDK contract).

anthropic 2.x builds on httpx2, so the mock transport must come from httpx2, not httpx.
"""
import asyncio
import json

import anthropic
import httpx2

from adapters.base import AdapterConfig
from adapters.claude import ClaudeAdapter


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _handler(request: httpx2.Request) -> httpx2.Response:
    body = json.loads(request.content)
    assert body["model"] == "claude-x" and body["system"] == "sys"
    if body.get("stream"):
        message = {"id": "m", "type": "message", "role": "assistant", "model": "claude-x", "content": [],
                   "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 3, "output_tokens": 0}}
        events = _sse("message_start", {"type": "message_start", "message": message})
        events += _sse("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})
        for piece in ("Hel", "lo"):
            events += _sse("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": piece}})
        events += _sse("content_block_stop", {"type": "content_block_stop", "index": 0})
        events += _sse("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 2}})
        events += _sse("message_stop", {"type": "message_stop"})
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=events)
    return httpx2.Response(200, json={"id": "m", "type": "message", "role": "assistant", "model": "claude-x",
                                      "content": [{"type": "text", "text": "Hello"}], "stop_reason": "end_turn",
                                      "stop_sequence": None, "usage": {"input_tokens": 3, "output_tokens": 2}})


class _MockedClaude(ClaudeAdapter):
    def _client(self, config):
        return anthropic.AsyncAnthropic(api_key="test", http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(_handler)))


_CONFIG = AdapterConfig(adapter="claude", api_key="test", model="claude-x", system_prompt="sys")


def test_invoke_returns_text_tokens_and_model():
    result = asyncio.run(_MockedClaude().invoke("hi", _CONFIG))
    assert (result.content, result.tokens_used, result.model) == ("Hello", 5, "claude-x")


def test_stream_yields_text_deltas():
    async def collect():
        return [chunk async for chunk in _MockedClaude().stream("hi", _CONFIG)]

    assert asyncio.run(collect()) == ["Hel", "lo"]
