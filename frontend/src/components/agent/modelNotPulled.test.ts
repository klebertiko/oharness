import { describe, expect, it } from "vitest";
import { missingProviderAction, modelNotPulled, providerReadiness, rowStatus, rowTone } from "./chatProvider";
import { nextStep } from "../providers/nextStep";
import type { Connection } from "../providers/providerStore";

const ollama = (over: Partial<Connection> = {}): Connection =>
  ({
    id: "ollama-local", provider: "ollama", label: "Ollama local", residence: "local", endpoint: "", secret: null,
    health: "live", detail: "", probes: [], facts: [], enabled: true, lastProbe: "",
    models: [{ id: "gemma4:26b", ctx: 0 }, { id: "llama3.2:latest", ctx: 0 }], modelsFromEndpoint: true,
    defaultModel: "qwen3:8b", ...over,
  }) as Connection;

describe("Model not pulled (local Ollama)", () => {
  it("a default model missing from the endpoint's own list is not ready, and says so", () => {
    expect(modelNotPulled(ollama())).toBe("qwen3:8b");
    expect(providerReadiness(ollama())).toMatchObject({ ready: false, state: "needs-model", missing: "model-not-pulled" });
    expect(rowStatus(ollama())).toBe("Model not pulled");
    expect(rowTone(ollama())).toBe("attention");
  });

  it("offers one action: copy `ollama pull <id>`, then test again", () => {
    expect(nextStep(ollama())).toMatchObject({
      kind: "copy", copy: "ollama pull qwen3:8b", label: "Copy `ollama pull qwen3:8b`", status: "Model not pulled", thenRetest: true,
    });
  });

  it("the composer names the model to pull", () => {
    expect(missingProviderAction([ollama()], "ollama-local")).toEqual({ text: "Pull qwen3:8b to send", id: "ollama-local" });
  });

  it.each([
    ["a pulled model", { defaultModel: "gemma4:26b" }],
    ["an untagged name that matches :latest", { defaultModel: "llama3.2" }],
    ["no default model yet (that is 'No model chosen')", { defaultModel: "" }],
    ["a static catalog list, which proves nothing", { modelsFromEndpoint: false }],
    ["Ollama Cloud, which does not pull", { residence: "cloud" as const }],
    ["a failed probe, whose list may be stale", { health: "fault" as const }],
    ["a probe in flight", { health: "probing" as const }],
    ["another provider", { provider: "openrouter" as const }],
  ])("is not raised for %s", (_name, over) => {
    expect(modelNotPulled(ollama(over as Partial<Connection>))).toBeNull();
  });
});
