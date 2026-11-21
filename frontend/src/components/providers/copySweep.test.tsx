import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { en } from "@/i18n/messages.en";
import { ptBR } from "@/i18n/messages.pt-BR";
import type { MessageKey } from "@/i18n/translate";
import { translate } from "@/i18n/translate";
import { ProvidersScreen } from "./ProvidersScreen";
import { useProviderStore, type Connection } from "./providerStore";
import { PROVIDER_ERROR_CODES, providerErrorText } from "./errorCatalog";
import { UsageLimitBanner } from "./UsageLimitBanner";

vi.mock("@/lib/usageApi", () => ({ usageApi: { summary: vi.fn(), setBudget: vi.fn() } }));

const EMAIL_CANARY = "person@example.com";
const FORBIDDEN = /\b(residence|capability|billing|handoff|preset|framework|sample|template|copilot)\b/i;
const ENGLISH = ["Needs action", "How the handoff works", "Pay per token", "Turn on", "Not connected", "Sign-in needed", "On this device", "Your plan"];

const conn = (over: Partial<Connection>): Connection => ({
  id: "ollama-local", provider: "ollama", label: "Ollama local", residence: "local", endpoint: "http://127.0.0.1:11434/v1",
  secret: null, health: "live", detail: "", probes: [], facts: [], models: [], defaultModel: "", enabled: true, lastProbe: "", ...over,
});

afterEach(() => {
  cleanup();
  useLocaleStore.setState({ locale: "en" });
});

describe("providers copy in pt-BR", () => {
  it("does not show jargon or fixed English on the screen or in the limit banner", () => {
    useLocaleStore.setState({ locale: "pt-BR" });
    useProviderStore.setState({
      loadState: "ready",
      selectedId: "cursor",
      connections: [
        conn({ id: "anthropic", provider: "anthropic", label: "Anthropic", residence: "cloud", endpoint: "https://api.example.test" }),
        conn({ id: "cursor", provider: "cursor", label: "Cursor", residence: "cloud", endpoint: "https://api.example.test", models: [] }),
        conn({}),
      ],
    });
    render(<ProvidersScreen />);
    render(
      <UsageLimitBanner
        resetAt="2026-11-21T09:20:00Z"
        draft="mensagem"
        accounts={[]}
        onHoldDraft={() => undefined}
        onUseAccount={() => undefined}
        onUseApiKey={() => undefined}
        onRelease={() => undefined}
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(FORBIDDEN);
    for (const leak of ENGLISH) expect(text, leak).not.toContain(leak);
    expect(text).toContain("Assinatura");
    expect(text).toContain("Tarefas de agente");
    expect(text).toContain("Limite da assinatura atingido");
    expect(text).not.toContain(EMAIL_CANARY);
  });

  it("says the offline state in plain Portuguese", () => {
    useLocaleStore.setState({ locale: "pt-BR" });
    useProviderStore.setState({ loadState: "offline", connections: [conn({})], selectedId: "" });
    render(<ProvidersScreen />);
    expect(screen.getByRole("alert").textContent).toContain("Sem conexão com o app");
    expect(document.body.textContent).toContain("Não dá para verificar agora");
  });

  it("gives every error class a plain sentence in both languages", () => {
    for (const code of PROVIDER_ERROR_CODES) {
      const keys = providerErrorText(code);
      for (const part of [keys.what, keys.why, keys.action]) {
        for (const locale of ["en", "pt-BR"] as const) {
          const text = translate(locale, part);
          expect(text, `${locale} ${part}`).not.toMatch(FORBIDDEN);
          expect(text.trim()).not.toBe("");
        }
      }
    }
    expect((en as Record<string, string>)["providers.limit.hold"]).not.toMatch(FORBIDDEN);
    expect((ptBR as Record<string, string>)["providers.limit.hold" as MessageKey]).toBe("Esperar e enviar quando liberar");
  });
});
