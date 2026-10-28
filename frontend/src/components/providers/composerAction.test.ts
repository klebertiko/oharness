import { afterEach, describe, expect, it, vi } from "vitest";
import { missingProviderAction, performInPlace } from "./composerAction";
import { closestToReady, distanceToReady, stepText } from "./nextStep";
import type { Connection } from "./providerStore";

const conn = (over: Partial<Connection>): Connection =>
  ({
    id: "c", provider: "openrouter", label: "OpenRouter", residence: "cloud", endpoint: "", secret: null, health: "setup",
    detail: "", probes: [], facts: [], models: [], defaultModel: "", enabled: false, lastProbe: "", ...over,
  }) as Connection;

afterEach(() => vi.unstubAllGlobals());

describe("closest to ready", () => {
  it("a missing model beats the off switch, a failure, and a missing credential", () => {
    const needsModel = conn({ id: "m", provider: "ollama", residence: "local", label: "Ollama local", enabled: true, health: "live" });
    const off = conn({ id: "o", provider: "anthropic", label: "Anthropic", secret: null });
    const fault = conn({ id: "f", health: "fault", enabled: true, detail: "HTTP 429 from x." });
    const key = conn({ id: "k" });
    expect([needsModel, off, fault, key].map(distanceToReady)).toEqual([0, 1, 2, 3]);
    expect(closestToReady([key, fault, off, needsModel])?.id).toBe("m");
  });

  it("an uninstalled CLI is as far as a missing key, not as near as a retry", () => {
    const missing = conn({ provider: "anthropic", label: "Anthropic", health: "setup", detail: "claude CLI not found on PATH. Install Claude Code, then run `claude login`." });
    expect(distanceToReady(missing)).toBe(3);
  });

  it("a connection that is ready has no distance", () => {
    expect(distanceToReady(conn({ enabled: true, health: "live", defaultModel: "m", secret: { service: "s", prefix: "", tail: "", length: 0, vault: "backend", savedAt: "" } }))).toBeNull();
  });
});

describe("stepText", () => {
  it("adds the connection unless the label already names it, and ignores names too short to mean anything", () => {
    expect(stepText(conn({}), { kind: "paste", label: "Paste an OpenRouter key", hint: "" })).toBe("Paste an OpenRouter key");
    expect(stepText(conn({}), { kind: "turnOn", label: "Turn on", hint: "" })).toBe("Turn on · OpenRouter");
    expect(stepText(conn({ label: "a" }), { kind: "turnOn", label: "Turn on", hint: "" })).toBe("Turn on · a");
  });
});

describe("the composer's call to action", () => {
  it("with Auto and nothing ready it names the nearest connection's step", () => {
    const action = missingProviderAction([conn({ id: "k" }), conn({ id: "o", provider: "anthropic", label: "Anthropic" })], null);
    expect(action).toMatchObject({ text: "Turn on · Anthropic", id: "o" });
  });

  it("a click copies the command or opens the page when that is what the label says, and does nothing else", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const open = vi.fn();
    vi.stubGlobal("open", open);
    performInPlace({ kind: "copy", label: "Copy `ollama serve`", hint: "", copy: "ollama serve" });
    expect(writeText).toHaveBeenCalledWith("ollama serve");
    performInPlace({ kind: "link", label: "Open billing", hint: "", href: "https://example.test/billing" });
    expect(open).toHaveBeenCalledWith("https://example.test/billing", "_blank", "noopener,noreferrer");
    writeText.mockClear();
    open.mockClear();
    performInPlace({ kind: "paste", label: "Paste a key", hint: "" });
    performInPlace(undefined);
    expect(writeText).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});
