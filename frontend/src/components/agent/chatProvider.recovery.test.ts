import { describe, expect, it } from "vitest";
import {
  chatProviderOptions,
  chatProviderStatus,
  pickChatProvider,
  providerReadiness,
} from "./chatProvider";
import { missingProviderAction } from "@/components/providers/composerAction";
import type { Connection } from "@/components/providers/providerStore";

/* providers-recovery: readiness must describe what a run will actually do.
   F2 (agent-only Cursor offered for chat), F7 (model-less HTTP connection
   read as ready), F1 (Auto listed as ready while resolving to nothing). */

const conn = (over: Partial<Connection>): Connection =>
  ({
    id: "c", provider: "anthropic", label: "Anthropic", residence: "cloud", health: "live", enabled: true,
    secret: null, models: [], defaultModel: "", detail: "", probes: [], facts: [], endpoint: "", lastProbe: "",
    ...over,
  }) as Connection;

const ollama = conn({ id: "ollama-local", provider: "ollama", label: "Ollama local", residence: "local" });
const cursor = conn({ id: "cursor", provider: "cursor", label: "Cursor" });
const anthropic = conn({ id: "anthropic", label: "Anthropic" });

describe("providerReadiness — model requirement (F7)", () => {
  it("an enabled HTTP connection with no default model is not ready and says a model is missing", () => {
    const r = providerReadiness(ollama);
    expect(r.ready).toBe(false);
    expect(r.state).toBe("needs-model");
    expect(r.missing).toBe("model");
    expect(r.label).toBe("No model chosen");
    expect(r.tone).toBe("attention");
    expect(chatProviderStatus(ollama)).toBe("No model chosen");
  });

  it("the same connection with a default model is ready", () => {
    expect(providerReadiness({ ...ollama, defaultModel: "gemma4:26b" }).ready).toBe(true);
  });

  it("a CLI connection never needs a model (its CLI has its own default)", () => {
    expect(providerReadiness(anthropic).ready).toBe(true);
  });

  it("a fault still outranks the missing model", () => {
    expect(providerReadiness({ ...ollama, health: "fault" }).state).toBe("fault");
  });

  it("the composer names the missing model instead of letting the run fail", () => {
    expect(missingProviderAction([ollama], "ollama-local")).toMatchObject({
      text: "Choose a model · Ollama local",
      id: "ollama-local",
    });
  });
});

describe("chat pickers only offer chat-capable connections (F2)", () => {
  it("never lists an agent-only connection", () => {
    const ids = chatProviderOptions([cursor, anthropic]).map((o) => o.id);
    expect(ids).not.toContain("cursor");
  });

  it("Auto never resolves to an agent-only connection", () => {
    expect(pickChatProvider([cursor])).toBeNull();
    expect(pickChatProvider([cursor, anthropic])?.id).toBe("anthropic");
  });
});

describe("Auto row (F1)", () => {
  it("is not ready when it resolves to nothing", () => {
    const auto = chatProviderOptions([{ ...anthropic, enabled: false }])[0];
    expect(auto.id).toBeNull();
    expect(auto.ready).toBe(false);
  });

  it("is ready when it resolves", () => {
    expect(chatProviderOptions([anthropic])[0].ready).toBe(true);
  });
});
