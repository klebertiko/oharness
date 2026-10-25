"""route_message() — one-call chat-vs-task routing. Every failure mode must
hand off to the real harness: under-triggering it costs tokens and an HITL
click, over-triggering it (skipping real work) would silently drop something
that needed the real gates."""

from __future__ import annotations

import asyncio

import pytest

from adapters.base import AdapterConfig, AdapterResult, AgentAdapter
from secret_store.memory import MemorySecrets
from triage import LayaRouteDecision, _laya_loopback_url, _parse_laya_decision, route_message


@pytest.mark.parametrize("value", ["80@evil.example", "0", "65536", "-1", "https://evil.example"])
def test_laya_port_cannot_change_the_loopback_origin(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv("LAYA_LOOPBACK_PORT", value)
    with pytest.raises(ValueError):
        _laya_loopback_url()


def test_laya_response_requires_the_versioned_schema() -> None:
    payload = {
        "schema_version": "unexpected-v2",
        "model_result": {"answers": {"engage_harness": {"noul": 0.9}}},
    }
    with pytest.raises(ValueError, match="schema"):
        _parse_laya_decision(payload, 1.0)


class _StubAdapter(AgentAdapter):
    def __init__(self, reply: str = "", error: str = "", tokens_used: int = 5) -> None:
        self.reply = reply
        self.error = error
        self.tokens_used = tokens_used
        self.calls: list[str] = []

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        self.calls.append(prompt)
        if self.error:
            return AdapterResult(content="", error=self.error, tokens_used=self.tokens_used)
        return AdapterResult(content=self.reply, tokens_used=self.tokens_used)

    async def stream(self, prompt: str, config: AdapterConfig):
        yield self.reply


def _connections() -> dict[str, dict]:
    return {
        "anthropic": {
            "id": "anthropic",
            "provider": "anthropic",
            "label": "Anthropic",
            "residence": "cloud",
            "endpoint": "https://api.anthropic.com",
            "enabled": True,
            "secretRef": None,
        }
    }


def _resolved(adapter: AgentAdapter):
    from providers.resolution import ResolvedProvider

    return ResolvedProvider(
        adapter_name="claude",
        adapter=adapter,
        config=AdapterConfig(adapter="claude", model=""),
        connection_id="anthropic",
        connection_label="Anthropic",
    )


def test_a_direct_answer_is_used_as_the_reply_with_no_second_call(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = _StubAdapter(reply="Oi! Como posso ajudar você hoje?")
    monkeypatch.setattr("triage.resolve_node_provider", lambda *a, **k: _resolved(stub))

    routed = asyncio.run(
        route_message("olá", ["anthropic"], connections=_connections(), secrets_store=MemorySecrets())
    )
    assert routed.engage_harness is False
    assert routed.reply == "Oi! Como posso ajudar você hoje?"
    assert routed.adapter_name == "claude"
    assert len(stub.calls) == 1  # one call total — the answer IS the routing decision


def test_the_engage_token_routes_to_the_full_harness(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = _StubAdapter(reply="<<ENGAGE_HARNESS>>")
    monkeypatch.setattr("triage.resolve_node_provider", lambda *a, **k: _resolved(stub))

    routed = asyncio.run(
        route_message(
            "implemente validação de CPF",
            ["anthropic"],
            connections=_connections(),
            secrets_store=MemorySecrets(),
        )
    )
    assert routed.engage_harness is True
    assert routed.reply == ""
    # SEC P3-2: this call already spent real tokens before deciding to hand
    # off to the harness -- that spend must not be silently dropped just
    # because routing didn't use it as the final reply.
    assert routed.tokens == 5
    assert routed.connection_id == "anthropic"
    assert routed.adapter_name == "claude"


def test_confident_laya_engage_skips_the_model_triage_call(monkeypatch: pytest.MonkeyPatch) -> None:
    async def laya_decide(_instruction: str) -> LayaRouteDecision:
        return LayaRouteDecision(engage_harness=True, confidence=0.93, latency_ms=12.5)

    def provider_must_not_resolve(*_args, **_kwargs):
        raise AssertionError("a confident Laya engage decision must skip model triage")

    monkeypatch.setattr("triage.resolve_node_provider", provider_must_not_resolve)

    routed = asyncio.run(
        route_message(
            "implemente validação de CPF",
            ["anthropic"],
            connections=_connections(),
            secrets_store=MemorySecrets(),
            laya_decide=laya_decide,
        )
    )

    assert routed.engage_harness is True
    assert routed.decision_source == "laya"
    assert routed.decision_reason == "confident"
    assert routed.decision_confidence == pytest.approx(0.93)
    assert routed.decision_latency_ms == pytest.approx(12.5)
    assert routed.tokens == 0


def test_confident_laya_direct_uses_model_only_to_write_nilos_reply(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stub = _StubAdapter(reply="Sim, 1 + 1 = 2.")
    monkeypatch.setattr("triage.resolve_node_provider", lambda *a, **k: _resolved(stub))

    async def laya_decide(_instruction: str) -> LayaRouteDecision:
        return LayaRouteDecision(engage_harness=False, confidence=0.98, latency_ms=8)

    routed = asyncio.run(
        route_message(
            "1+1 é 2?",
            ["anthropic"],
            connections=_connections(),
            secrets_store=MemorySecrets(),
            laya_decide=laya_decide,
        )
    )

    assert routed.engage_harness is False
    assert routed.reply == "Sim, 1 + 1 = 2."
    assert routed.decision_source == "laya"
    assert routed.decision_confidence == pytest.approx(0.98)
    assert len(stub.calls) == 1
    assert "<<ENGAGE_HARNESS>>" not in stub.calls[0]


def test_provider_failure_after_laya_direct_is_attributed_to_safety_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _RaisingAdapter(_StubAdapter):
        async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
            raise OSError("provider unavailable")

    monkeypatch.setattr("triage.resolve_node_provider", lambda *a, **k: _resolved(_RaisingAdapter()))

    async def laya_decide(_instruction: str) -> LayaRouteDecision:
        return LayaRouteDecision(engage_harness=False, confidence=0.98, latency_ms=8)

    routed = asyncio.run(
        route_message(
            "1+1 é 2?",
            ["anthropic"],
            connections=_connections(),
            secrets_store=MemorySecrets(),
            laya_decide=laya_decide,
        )
    )

    assert routed.engage_harness is True
    assert routed.decision_source == "model_fallback"
    assert routed.decision_reason == "provider_unavailable"


@pytest.mark.parametrize("failure", ["low_confidence", "unavailable"])
def test_laya_uncertainty_or_outage_falls_back_to_the_existing_model_triage(
    monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    stub = _StubAdapter(reply="<<ENGAGE_HARNESS>>")
    monkeypatch.setattr("triage.resolve_node_provider", lambda *a, **k: _resolved(stub))

    async def laya_decide(_instruction: str) -> LayaRouteDecision:
        if failure == "unavailable":
            raise OSError("loopback down")
        return LayaRouteDecision(engage_harness=True, confidence=0.51, latency_ms=4)

    routed = asyncio.run(
        route_message(
            "investigue isto",
            ["anthropic"],
            connections=_connections(),
            secrets_store=MemorySecrets(),
            laya_decide=laya_decide,
        )
    )

    assert routed.engage_harness is True
    assert routed.decision_source == "model_fallback"
    assert routed.decision_reason == failure
    assert len(stub.calls) == 1
    assert "<<ENGAGE_HARNESS>>" in stub.calls[0]


def test_a_real_answer_mentioning_harness_words_is_not_misrouted(monkeypatch: pytest.MonkeyPatch) -> None:
    # Regression for a real defect a gauntlet-loop critic found (2026-09-11)
    # against the original `HANDOFF:`-prefix sentinel: a `startswith()` check
    # collided with any genuine answer opening with that word. The token is
    # non-natural-language now and checked by exact match, but a real answer
    # that happens to *discuss* the crew/harness by name must still never be
    # misrouted just because it shares vocabulary with the mechanism.
    reply = "A harness here is the crew of roles — PO, SM, BE, FE — that build and review real work."
    stub = _StubAdapter(reply=reply)
    monkeypatch.setattr("triage.resolve_node_provider", lambda *a, **k: _resolved(stub))

    routed = asyncio.run(
        route_message(
            "what's a harness in this app?",
            ["anthropic"],
            connections=_connections(),
            secrets_store=MemorySecrets(),
        )
    )
    assert routed.engage_harness is False
    assert routed.reply == reply


def test_hands_off_when_the_call_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    # tokens_used=7 simulates a real vendor response that reported usage
    # before surfacing an error (e.g. a content-filter stop) -- distinct
    # from the adapter call itself raising (adapters/base.py's `invoke`
    # never returning at all), which has no result to salvage tokens from.
    stub = _StubAdapter(error="boom", tokens_used=7)
    monkeypatch.setattr("triage.resolve_node_provider", lambda *a, **k: _resolved(stub))

    routed = asyncio.run(
        route_message("olá", ["anthropic"], connections=_connections(), secrets_store=MemorySecrets())
    )
    assert routed.engage_harness is True
    # SEC P3-2: the call completed (with an error string, not an exception)
    # and reported real usage -- must still be recorded, not dropped.
    assert routed.tokens == 7
    assert routed.connection_id == "anthropic"


def test_hands_off_when_the_reply_is_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = _StubAdapter(reply="   ", tokens_used=3)
    monkeypatch.setattr("triage.resolve_node_provider", lambda *a, **k: _resolved(stub))

    routed = asyncio.run(
        route_message("olá", ["anthropic"], connections=_connections(), secrets_store=MemorySecrets())
    )
    assert routed.engage_harness is True
    assert routed.tokens == 3  # SEC P3-2: real spend, must not be dropped
    assert routed.connection_id == "anthropic"


def test_hands_off_with_no_provider_pinned() -> None:
    routed = asyncio.run(
        route_message("olá", [], connections=_connections(), secrets_store=MemorySecrets())
    )
    assert routed.engage_harness is True
    assert routed.tokens == 0  # no adapter call was ever made -- nothing to record


def test_nilos_voice_is_layered_onto_the_intake_call(monkeypatch: pytest.MonkeyPatch) -> None:
    # SOUL.md is Nilo's voice for this one front-door call — never the
    # harness crew's. It must reach the adapter as system_prompt, not get
    # silently dropped or only apply after routing has already happened.
    captured: dict = {}

    class _CapturingAdapter(_StubAdapter):
        async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
            captured["system_prompt"] = config.system_prompt
            return await super().invoke(prompt, config)

    stub = _CapturingAdapter(reply="oi")
    monkeypatch.setattr("triage.resolve_node_provider", lambda *a, **k: _resolved(stub))

    asyncio.run(
        route_message("olá", ["anthropic"], connections=_connections(), secrets_store=MemorySecrets())
    )
    assert "Nilo" in captured["system_prompt"]


def test_hands_off_when_the_connection_cannot_resolve() -> None:
    routed = asyncio.run(
        route_message("olá", ["ghost"], connections=_connections(), secrets_store=MemorySecrets())
    )
    assert routed.engage_harness is True
    assert routed.tokens == 0  # no adapter call was ever made -- nothing to record


def test_cwd_is_forwarded_to_resolve_node_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    # The intake call runs in the same chosen workspace folder as the real
    # harness/direct nodes it stands in for — routers/execution.py has
    # already validated this path against cowork_projects before it ever
    # reaches here (see its `_validated_project_cwd` docstring).
    stub = _StubAdapter(reply="oi")
    captured: dict = {}

    def _capture(data, node_type, label, *, connections, secrets_store, cwd=None):
        captured["cwd"] = cwd
        return _resolved(stub)

    monkeypatch.setattr("triage.resolve_node_provider", _capture)

    asyncio.run(
        route_message(
            "olá",
            ["anthropic"],
            connections=_connections(),
            secrets_store=MemorySecrets(),
            cwd="D:\\Development\\src\\OHarness",
        )
    )
    assert captured["cwd"] == "D:\\Development\\src\\OHarness"


def test_cwd_defaults_to_none_when_the_caller_omits_it(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = _StubAdapter(reply="oi")
    captured: dict = {}

    def _capture(data, node_type, label, *, connections, secrets_store, cwd=None):
        captured["cwd"] = cwd
        return _resolved(stub)

    monkeypatch.setattr("triage.resolve_node_provider", _capture)

    asyncio.run(
        route_message("olá", ["anthropic"], connections=_connections(), secrets_store=MemorySecrets())
    )
    assert captured["cwd"] is None


def test_workspace_folder_is_named_in_the_system_prompt_when_chosen(monkeypatch: pytest.MonkeyPatch) -> None:
    # Real bug, reported 2026-09-17 (screenshot: composer chip showed
    # "Development" selected; asked "em que folder estamos agora?", Nilo
    # replied "Não tenho visibilidade do diretório de trabalho daqui").
    # test_cwd_is_forwarded_to_resolve_node_provider (above) already proves
    # cwd reaches resolve_node_provider -- but AdapterConfig.extra["cwd"] is
    # only ever read as a CLI adapter's *subprocess* cwd (cli_shared.
    # resolve_cwd) or not at all (OpenAICompatibleAdapter.invoke() never
    # touches config.extra) -- so the model's own input never named any
    # folder, on any adapter. This asserts the fix: the chosen folder must
    # reach the model as text it actually reads, i.e. system_prompt.
    captured: dict = {}

    class _CapturingAdapter(_StubAdapter):
        async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
            captured["system_prompt"] = config.system_prompt
            return await super().invoke(prompt, config)

    stub = _CapturingAdapter(reply="A gente está na pasta Development.")
    monkeypatch.setattr("triage.resolve_node_provider", lambda *a, **k: _resolved(stub))

    asyncio.run(
        route_message(
            "em que folder estamos agora?",
            ["anthropic"],
            connections=_connections(),
            secrets_store=MemorySecrets(),
            # Matches the reported screenshot's composer chip exactly
            # ("📁 Development") -- deliberately a name absent from SOUL.md's
            # own text, so this assertion can't pass by coincidence the way
            # "OHarness" (used elsewhere in Nilo's voice) would.
            cwd="D:\\Development",
        )
    )
    system_prompt = captured["system_prompt"]
    assert "Nilo" in system_prompt  # her voice is added to, never replaced
    assert "Development" in system_prompt  # the folder's own name, stated
    assert "D:\\Development" in system_prompt  # full path too


def test_no_workspace_line_is_added_when_no_folder_is_chosen(monkeypatch: pytest.MonkeyPatch) -> None:
    # "No folder" is a first-class choice (WorkspacePicker.tsx) -- Nilo must
    # not invent a working folder when the person picked none. SOUL.md's own
    # voice now mentions "working folder" in the abstract (she can explain
    # she has none picked) -- that's fine and expected; what must stay
    # absent is `_workspace_context`'s concrete per-chat sentence naming one.
    captured: dict = {}

    class _CapturingAdapter(_StubAdapter):
        async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
            captured["system_prompt"] = config.system_prompt
            return await super().invoke(prompt, config)

    stub = _CapturingAdapter(reply="oi")
    monkeypatch.setattr("triage.resolve_node_provider", lambda *a, **k: _resolved(stub))

    asyncio.run(
        route_message("olá", ["anthropic"], connections=_connections(), secrets_store=MemorySecrets())
    )
    assert "This chat's working folder is" not in captured["system_prompt"]


def test_the_reply_carries_the_measured_duration_of_the_one_adapter_call(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Slow(_StubAdapter):
        async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
            await asyncio.sleep(0.03)
            return await super().invoke(prompt, config)

    monkeypatch.setattr("triage.resolve_node_provider", lambda *a, **k: _resolved(_Slow(reply="Oi!")))
    routed = asyncio.run(
        route_message("olá", ["anthropic"], connections=_connections(), secrets_store=MemorySecrets())
    )
    assert routed.latency_ms >= 25


def test_provider_reported_tokens_are_not_marked_estimated(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("triage.resolve_node_provider", lambda *a, **k: _resolved(_StubAdapter(reply="Oi!", tokens_used=19)))
    routed = asyncio.run(
        route_message("olá", ["anthropic"], connections=_connections(), secrets_store=MemorySecrets())
    )
    assert routed.tokens == 19
    assert routed.tokens_estimated is False


def test_a_token_count_derived_from_the_reply_length_is_marked_estimated(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("triage.resolve_node_provider", lambda *a, **k: _resolved(_StubAdapter(reply="Oi! Tudo bem?", tokens_used=0)))
    routed = asyncio.run(
        route_message("olá", ["anthropic"], connections=_connections(), secrets_store=MemorySecrets())
    )
    assert routed.tokens == len("Oi! Tudo bem?") // 4
    assert routed.tokens_estimated is True
