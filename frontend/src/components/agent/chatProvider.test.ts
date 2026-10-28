import { describe, expect, it } from "vitest";
import { chatProviderOptions, pickChatProvider } from "./chatProvider";
import { missingProviderAction } from "@/components/providers/composerAction";
import type { Connection } from "@/components/providers/providerStore";

const conn = (over: Partial<Connection>): Connection =>
  ({ id: "c", provider: "anthropic", label: "Anthropic", residence: "cloud", health: "live", enabled: true, ...over }) as Connection;

const anthropic = conn({ id: "an", label: "Anthropic", residence: "cloud" });
const ollama = conn({ id: "ol", label: "Ollama local", residence: "local" });
const openai = conn({ id: "oa", label: "OpenAI", residence: "cloud", health: "fault" });

describe("pickChatProvider", () => {
  it("Auto (no pick): first live cloud connection, in live mode, chosen=false", () => {
    // `id` is the real connection id even on Auto — the harness graph needs
    // a concrete fallback to carry per unpinned node, not just a display
    // label (see backend/providers/resolution.py's precedence docstring).
    expect(pickChatProvider([ollama, anthropic])).toEqual({
      id: "an",
      label: "Anthropic",
      mode: "live",
      chosen: false,
    });
  });

  it("honours the person's pick when that connection is live", () => {
    expect(pickChatProvider([anthropic, ollama], "ol")).toEqual({
      id: "ol",
      label: "Ollama local",
      mode: "local",
      chosen: true,
    });
  });

  it("keeps an unavailable explicit choice from silently routing to another provider", () => {
    expect(pickChatProvider([anthropic, openai], "oa")).toBeNull();
    expect(pickChatProvider([anthropic], "does-not-exist")).toBeNull();
    expect(pickChatProvider([anthropic, { ...ollama, enabled: false }], "ol")).toBeNull();
  });

  it("retains enabled authority after reload before a new probe has run", () => {
    const unverified = { ...anthropic, health: "setup" as const };
    expect(pickChatProvider([unverified], "an")?.id).toBe("an");
    expect(pickChatProvider([unverified])?.id).toBe("an");
  });

  it("never returns mock, and returns null when nothing is connected", () => {
    expect(pickChatProvider([openai], "oa")).toBeNull();
    expect(pickChatProvider([])).toBeNull();
  });
});

describe("chatProviderOptions", () => {
  it("lists Auto first, then every connection with a ready flag and a state detail", () => {
    const opts = chatProviderOptions([anthropic, ollama, openai]);
    expect(opts[0]).toEqual({ id: null, label: "Auto", detail: "Uses Anthropic · Verified", ready: true, tone: "verified" });
    expect(opts.map((o) => [o.label, o.ready])).toEqual([
      ["Auto", true],
      ["Anthropic", true],
      ["Ollama local", true],
      ["OpenAI", false],
    ]);
    expect(opts.find((o) => o.label === "OpenAI")?.detail).toBe("Unavailable · Test failed");
    expect(opts.find((o) => o.label === "Ollama local")?.detail).toBe("Verified · On-device");
  });
});

describe("chatProviderOptions tone", () => {
  it("gives every health/enabled combination its own tone, and separates a failed credential from one never configured", () => {
    const live = conn({ id: "a", label: "A", health: "live", enabled: true });
    const degraded = conn({ id: "b", label: "B", health: "degraded", enabled: true });
    const probing = conn({ id: "c", label: "C", health: "probing", enabled: true });
    const fault = conn({ id: "d", label: "D", health: "fault", enabled: true });
    const neverProbed = conn({ id: "e", label: "E", health: "setup", enabled: true });
    // Genuinely never configured: no credential yet, turned off, never probed —
    // must read and look distinct from `fault` (a credential that WAS tried
    // and rejected), not just distinct from "Verified".
    const neverConfigured = conn({ id: "f", label: "F", health: "setup", enabled: false, lastProbe: "" });

    const opts = chatProviderOptions([live, degraded, probing, fault, neverProbed, neverConfigured]);
    const row = (label: string) => opts.find((o) => o.label === label)!;

    expect(row("A")).toMatchObject({ tone: "verified", detail: "Verified · Cloud" });
    expect(row("B")).toMatchObject({ tone: "attention", detail: "Needs attention · Cloud" });
    expect(row("C")).toMatchObject({ tone: "checking", detail: "Checking connection · Cloud" });
    expect(row("D")).toMatchObject({ tone: "failing", detail: "Unavailable · Test failed" });
    expect(row("E")).toMatchObject({ tone: "unverified", detail: "Not verified · Cloud" });
    expect(row("F")).toMatchObject({ tone: "unconfigured", detail: "Not connected · Cloud" });

    // The historical bug this story fixes: a failed credential (D) and a
    // connection nobody has ever configured (F) used to both read
    // "Unavailable" and render pixel-identical.
    expect(row("F").detail.startsWith("Unavailable")).toBe(false);
    expect(row("F").tone).not.toBe(row("D").tone);
  });

  it("gives Auto the tone of the connection it resolves to, and 'unconfigured' when nothing is available", () => {
    expect(chatProviderOptions([anthropic, ollama, openai]).find((o) => o.label === "Auto")?.tone).toBe("verified");
    expect(chatProviderOptions([openai]).find((o) => o.label === "Auto")?.tone).toBe("unconfigured");
  });
});

describe("missingProviderAction", () => {
  // Credential shape is read from the catalog, not hardcoded by vendor name —
  // openrouter is "api-key" (paste a key), anthropic is "cli" (a session
  // switch, nothing to type). See components/providers/catalog.ts.
  const keyed = conn({ id: "or", provider: "openrouter", label: "OpenRouter", enabled: false, health: "setup" });
  const keyless = conn({ id: "an", provider: "anthropic", label: "Anthropic", enabled: false, health: "setup" });

  it("is null the moment a provider actually resolves", () => {
    expect(missingProviderAction([anthropic], "an")).toBeNull();
    expect(missingProviderAction([anthropic])).toBeNull();
  });

  it("names the paste-a-key action for an api-key credential, never a bare 'Unavailable'", () => {
    expect(missingProviderAction([keyed], "or")).toMatchObject({ text: "Paste an OpenRouter key", id: "or" });
  });

  it("names the on/off-switch action for a CLI or keyless credential", () => {
    expect(missingProviderAction([keyless], "an")).toMatchObject({ text: "Turn on · Anthropic", id: "an" });
  });

  it("falls back to a generic prompt when there is nothing concrete to expand", () => {
    expect(missingProviderAction([], null)).toEqual({ text: "Connect a provider to send", id: null });
    expect(missingProviderAction([anthropic], "gone")).toEqual({ text: "Pick a provider to send", id: null });
  });
});
