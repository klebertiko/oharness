import { afterEach, describe, expect, it } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { nextStep } from "./nextStep";
import type { Connection } from "./providerStore";

const conn = (over: Partial<Connection>): Connection =>
  ({
    id: "c", provider: "openrouter", label: "OpenRouter", residence: "cloud", endpoint: "", secret: null,
    health: "fault", detail: "", probes: [], facts: [], models: [], defaultModel: "m", enabled: true, lastProbe: "",
    ...over,
  }) as Connection;

describe("nextStep - one action per state", () => {
  it.each([
    ["401 unauthorized — the key was rejected or has been revoked.", "Replace key", "Key rejected", "replaceKey"],
    ["HTTP 403 from https://openrouter.ai/api/v1.", "Replace key", "Key rejected", "replaceKey"],
    ["HTTP 429 from https://openrouter.ai/api/v1.", "Test again later", "Rate limited", "retest"],
    ["HTTP 402 from https://openrouter.ai/api/v1.", "Open billing", "Out of credits", "link"],
    ["Could not reach https://openrouter.ai/api/v1.", "Test again", "Unreachable", "retest"],
    ["HTTP 500 from https://openrouter.ai/api/v1.", "Test again", "Test failed", "retest"],
    ["", "Test again", "Test failed", "retest"],
  ])("openrouter fault %s", (detail, label, status, kind) => {
    expect(nextStep(conn({ detail }))).toMatchObject({ label, status, kind });
  });

  it("billing opens the vendor's page in the same step", () => {
    const step = nextStep(conn({ detail: "HTTP 402 from x." }));
    expect(step?.href).toBe("https://openrouter.ai/credits");
    expect(step?.thenRetest).toBe(true);
  });

  it("a local Ollama that is not running copies `ollama serve`; a cloud endpoint you can edit is checked", () => {
    const local = conn({ provider: "ollama", residence: "local", label: "Ollama local", detail: "Could not reach http://127.0.0.1:11434." });
    expect(nextStep(local)).toMatchObject({ kind: "copy", copy: "ollama serve", status: "Unreachable", thenRetest: true });
    const cloud = conn({ provider: "openai", label: "OpenAI", detail: "https://api.openai.com/v1 did not respond in time." });
    expect(nextStep(cloud)).toMatchObject({ kind: "checkEndpoint", label: "Check endpoint" });
  });

  it.each([
    ["anthropic", "claude CLI is installed but not logged in. Run `claude login`.", "claude login"],
    ["openai", "codex CLI is installed but not logged in. Run `codex login`.", "codex login"],
    ["cursor", "cursor-agent CLI is installed but not logged in. Run `cursor-agent login`.", "cursor-agent login"],
  ])("%s signed out copies its own login command", (provider, detail, login) => {
    const step = nextStep(conn({ provider: provider as Connection["provider"], health: "setup", enabled: false, detail }));
    expect(step).toMatchObject({ kind: "copy", copy: login, label: `Copy \`${login}\``, status: "Sign-in needed" });
  });

  it("a missing CLI opens its install guide, even while the connection is still off", () => {
    const step = nextStep(conn({ provider: "anthropic", health: "setup", enabled: false, detail: "claude CLI not found on PATH. Install Claude Code, then run `claude login`." }));
    expect(step).toMatchObject({ kind: "link", label: "Open install guide", status: "Not installed" });
    expect(step?.href).toMatch(/^https:\/\//);
  });

  it("without a known failure it falls back to the readiness step", () => {
    expect(nextStep(conn({ health: "setup", enabled: false, secret: null }))).toMatchObject({ kind: "paste", label: "Paste an OpenRouter key" });
    expect(nextStep(conn({ health: "live" }))).toBeNull();
  });
});

describe("nextStep in Brazilian Portuguese", () => {
  afterEach(() => useLocaleStore.setState({ locale: "en" }));

  it("speaks one language per state: label, hint and status, commands untouched", () => {
    useLocaleStore.setState({ locale: "pt-BR" });
    expect(nextStep(conn({ detail: "401 unauthorized — the key was rejected." }))).toMatchObject({ label: "Trocar a chave", status: "Chave recusada" });
    expect(nextStep(conn({ provider: "ollama", residence: "local", detail: "Could not reach http://127.0.0.1:11434." }))).toMatchObject({
      label: "Copiar `ollama serve`",
      copy: "ollama serve",
    });
    expect(nextStep(conn({ health: "setup", enabled: false, secret: null }))?.label).toBe("Colar a chave OpenRouter");
  });
});
