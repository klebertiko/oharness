"""Covers: OpenAI API, Ollama (localhost:11434/v1), LM Studio, any OpenAI-compatible runtime."""
import time
import json
from typing import AsyncIterator
import httpx
from .base import AgentAdapter, AdapterConfig, AdapterResult, ProbeResult

DEFAULT_ENDPOINTS = {
    "ollama": "http://host.docker.internal:11434/v1",
    "openai": "https://api.openai.com/v1",
    "lmstudio": "http://host.docker.internal:1234/v1",
}

# An endpoint is untrusted input: bound what a `GET /models` probe will read
# and what it will hand back to the UI.
MAX_PROBE_BODY_BYTES = 2 * 1024 * 1024
MAX_PROBE_MODELS = 2000
MAX_MODEL_ID_LEN = 200


def reported_tokens(usage) -> int | None:
    """The provider's own count for one call (prompt included), or None when it reported none."""
    if not isinstance(usage, dict):
        return None
    total = usage.get('total_tokens')
    if isinstance(total, int) and not isinstance(total, bool):
        return total
    parts = [usage.get('prompt_tokens'), usage.get('completion_tokens')]
    if any(isinstance(part, int) and not isinstance(part, bool) for part in parts):
        return sum(part for part in parts if isinstance(part, int) and not isinstance(part, bool))
    return None


class OpenAICompatibleAdapter(AgentAdapter):
    def __init__(self, *, transport: httpx.BaseTransport | None = None) -> None:
        # Injectable so tests can assert on real request/response handling
        # without hitting the network (see tests/test_openai_compatible.py) —
        # None (the default) is ordinary httpx behavior, a real connection.
        self._transport = transport

    async def stream_events(self, prompt: str, config: AdapterConfig) -> AsyncIterator[dict]:
        """Harness nodes, subagents and simple turns: the text, then the provider's usage report when it sends one."""
        messages = [{'role': 'system', 'content': config.system_prompt}] if config.system_prompt else []
        messages.append({'role': 'user', 'content': prompt})
        yield {'kind': 'phase', 'phase': 'writing', 'detail': config.model or config.adapter}
        async for event in self.stream_turn(messages, config):
            if event['kind'] in ('text', 'usage'):
                yield event

    async def stream_turn(self, messages: list[dict], config: AdapterConfig, tools: list[dict] | None = None) -> AsyncIterator[dict]:
        """One HTTP turn; assemble streamed function arguments before exposing calls."""
        endpoint = config.endpoint or DEFAULT_ENDPOINTS.get(config.adapter, 'https://api.openai.com/v1')
        payload = {'model': config.model, 'messages': messages, 'temperature': config.temperature,
                   'max_tokens': config.max_tokens, 'stream': True, 'stream_options': {'include_usage': True}}
        if tools:
            payload.update(tools=tools, tool_choice='auto')
        headers = {'Authorization': f'Bearer {config.api_key}'} if config.api_key else {}
        calls = {}
        async with httpx.AsyncClient(timeout=120, transport=self._transport) as client:
            async with client.stream('POST', f'{endpoint}/chat/completions', json=payload, headers=headers) as response:
                if response.status_code >= 400:
                    await response.aread()
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith('data: '):
                        continue
                    if line[6:] == '[DONE]':
                        break
                    try:
                        data = json.loads(line[6:])
                    except ValueError:
                        continue
                    tokens = reported_tokens(data.get('usage'))
                    if tokens is not None:
                        yield {'kind': 'usage', 'tokens': tokens}
                    choices = data.get('choices') or []
                    if not choices:
                        continue
                    delta = choices[0].get('delta') or {}
                    if delta.get('content'):
                        yield {'kind': 'text', 'text': delta['content']}
                    for fragment in delta.get('tool_calls') or []:
                        index = fragment.get('index', 0)
                        if not isinstance(index, int) or index < 0 or index >= 64:
                            raise ValueError('Provider tool call limit exceeded')
                        call = calls.setdefault(index, {'id': '', 'type': 'function', 'function': {'name': '', 'arguments': ''}})
                        if fragment.get('id'):
                            call['id'] += fragment['id']
                        function = fragment.get('function') or {}
                        for key in ('name', 'arguments'):
                            call['function'][key] += function.get(key) or ''
                        if sum(len(str(value)) for value in call.values()) > 262144:
                            raise ValueError('Provider tool arguments too large')
        if calls:
            yield {'kind': 'tool_calls', 'calls': [calls[index] for index in sorted(calls)]}

    @staticmethod
    async def _get_capped(client: httpx.AsyncClient, url: str, headers: dict) -> tuple[int, bytes | None]:
        """GET streaming at most MAX_PROBE_BODY_BYTES; body is None when over the cap."""
        async with client.stream("GET", url, headers=headers) as resp:
            if resp.status_code >= 400:
                return resp.status_code, b""
            chunks: list[bytes] = []
            size = 0
            async for chunk in resp.aiter_bytes():
                size += len(chunk)
                if size > MAX_PROBE_BODY_BYTES:
                    return resp.status_code, None
                chunks.append(chunk)
            return resp.status_code, b"".join(chunks)

    async def _probe_ollama(self, config: AdapterConfig) -> ProbeResult:
        """Ollama's own health surface: `GET /api/version` says the server is
        up, `GET /api/tags` lists models. The endpoint may or may not carry the
        OpenAI-compat `/v1` suffix (a running Ollama 404s `/models` without
        it), so probe the origin either way. Every body is read with a byte
        ceiling and the model list is capped before it is processed."""
        origin = (config.endpoint or DEFAULT_ENDPOINTS["ollama"]).rstrip("/")
        if origin.endswith("/v1"):
            origin = origin[: -len("/v1")]
        headers = {"Authorization": f"Bearer {config.api_key}"} if config.api_key else {}

        started = time.monotonic()
        tags_status, tags_body = 0, b""
        try:
            async with httpx.AsyncClient(timeout=10, transport=self._transport) as client:
                version_status, _ = await self._get_capped(client, f"{origin}/api/version", headers)
                if version_status < 400 or version_status == 404:
                    # 404 on /api/version: not a local server (Ollama Cloud) — tags decides.
                    tags_status, tags_body = await self._get_capped(client, f"{origin}/api/tags", headers)
        except httpx.ConnectError:
            return ProbeResult(ok=False, health="fault", detail=f"Could not reach {origin}.")
        except httpx.TimeoutException:
            return ProbeResult(ok=False, health="fault", detail=f"{origin} did not respond in time.")
        except httpx.HTTPError as exc:
            return ProbeResult(ok=False, health="fault", detail=str(exc))
        latency_ms = int((time.monotonic() - started) * 1000)

        if 401 in (version_status, tags_status):
            return ProbeResult(
                ok=False, health="fault", latency_ms=latency_ms,
                detail="401 unauthorized — the key was rejected or has been revoked.",
            )
        tags_ok = 0 < tags_status < 400
        if version_status >= 400 and not tags_ok:
            return ProbeResult(
                ok=False, health="fault", latency_ms=latency_ms,
                detail=f"HTTP {version_status} from {origin}.",
            )

        ids: list[str] = []
        total = 0
        if tags_ok and tags_body is not None:
            try:
                entries = json.loads(tags_body).get("models", [])
            except (ValueError, AttributeError):
                entries = []
            if isinstance(entries, list):
                total = len(entries)
                for m in entries[:MAX_PROBE_MODELS]:
                    if isinstance(m, dict) and isinstance(m.get("name"), str) and len(m["name"]) <= MAX_MODEL_ID_LEN:
                        ids.append(m["name"])
        models = sorted(set(ids))
        if total > MAX_PROBE_MODELS:
            detail = f"Showing the first {len(models)} of {total} models."
        elif models:
            detail = f"{len(models)} models available."
        else:
            detail = "Ollama is running."
        return ProbeResult(ok=True, health="live", latency_ms=latency_ms, detail=detail, models=models)

    async def probe(self, config: AdapterConfig) -> ProbeResult:
        """`GET /models` — every OpenAI-compatible surface serves it, it costs
        no tokens, and a bad or missing key still 401s there same as it would
        on a real completion, so this checks reachability and the credential
        in one request. Ollama uses its native endpoints instead (see
        `_probe_ollama`)."""
        if config.adapter == "ollama":
            return await self._probe_ollama(config)
        endpoint = config.endpoint or DEFAULT_ENDPOINTS.get(config.adapter, "https://api.openai.com/v1")
        headers = {}
        if config.api_key:
            headers["Authorization"] = f"Bearer {config.api_key}"

        started = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=10, transport=self._transport) as client:
                async with client.stream("GET", f"{endpoint}/models", headers=headers) as resp:
                    status_code = resp.status_code
                    body: bytes | None = b""
                    if status_code < 400:
                        chunks: list[bytes] = []
                        size = 0
                        async for chunk in resp.aiter_bytes():
                            size += len(chunk)
                            if size > MAX_PROBE_BODY_BYTES:
                                body = None
                                break
                            chunks.append(chunk)
                        if body is not None:
                            body = b"".join(chunks)
        except httpx.ConnectError:
            return ProbeResult(ok=False, health="fault", detail=f"Could not reach {endpoint}.")
        except httpx.TimeoutException:
            return ProbeResult(ok=False, health="fault", detail=f"{endpoint} did not respond in time.")
        except httpx.HTTPError as exc:
            return ProbeResult(ok=False, health="fault", detail=str(exc))
        latency_ms = int((time.monotonic() - started) * 1000)

        if status_code == 401:
            return ProbeResult(
                ok=False, health="fault", latency_ms=latency_ms,
                detail="401 unauthorized — the key was rejected or has been revoked.",
            )
        if status_code >= 400:
            return ProbeResult(
                ok=False, health="fault", latency_ms=latency_ms,
                detail=f"HTTP {status_code} from {endpoint}.",
            )
        if body is None:
            return ProbeResult(
                ok=False, health="fault", latency_ms=latency_ms,
                detail=f"{endpoint} sent a model list larger than 2 MB.",
            )

        try:
            data = json.loads(body).get("data", [])
        except (ValueError, AttributeError):
            # A 2xx whose body is not the OpenAI list shape: the endpoint is up
            # but exposes no usable model list — report that, not a fault.
            data = None
        if not isinstance(data, list):
            return ProbeResult(ok=True, health="live", latency_ms=latency_ms, detail="Reachable.", models=[])

        # Ids only — never echo the rest of the upstream body.
        ids = sorted({
            m["id"] for m in data
            if isinstance(m, dict) and isinstance(m.get("id"), str) and len(m["id"]) <= MAX_MODEL_ID_LEN
        })
        models = ids[:MAX_PROBE_MODELS]
        if len(ids) > len(models):
            detail = f"Showing the first {len(models)} of {len(ids)} models."
        else:
            detail = f"{len(models)} models available."
        return ProbeResult(ok=True, health="live", latency_ms=latency_ms, detail=detail, models=models)


    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        endpoint = config.endpoint or DEFAULT_ENDPOINTS.get(config.adapter, "https://api.openai.com/v1")
        messages = []
        if config.system_prompt:
            messages.append({"role": "system", "content": config.system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": config.model,
            "messages": messages,
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
            "stream": False,
        }
        headers = {"Content-Type": "application/json"}
        if config.api_key:
            headers["Authorization"] = f"Bearer {config.api_key}"

        async with httpx.AsyncClient(timeout=120, transport=self._transport) as client:
            resp = await client.post(f"{endpoint}/chat/completions", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            choice = data["choices"][0]["message"]["content"]
            usage = data.get("usage", {})
            return AdapterResult(
                content=choice,
                tokens_used=usage.get("total_tokens", 0),
                model=data.get("model", config.model),
            )

    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        endpoint = config.endpoint or DEFAULT_ENDPOINTS.get(config.adapter, "https://api.openai.com/v1")
        messages = []
        if config.system_prompt:
            messages.append({"role": "system", "content": config.system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": config.model,
            "messages": messages,
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
            "stream": True,
        }
        headers = {"Content-Type": "application/json"}
        if config.api_key:
            headers["Authorization"] = f"Bearer {config.api_key}"

        async with httpx.AsyncClient(timeout=120, transport=self._transport) as client:
            async with client.stream("POST", f"{endpoint}/chat/completions", json=payload, headers=headers) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        chunk = line[6:]
                        if chunk == "[DONE]":
                            break
                        import json
                        try:
                            data = json.loads(chunk)
                            delta = data["choices"][0]["delta"].get("content", "")
                            if delta:
                                yield delta
                        except (json.JSONDecodeError, KeyError, IndexError):
                            pass
