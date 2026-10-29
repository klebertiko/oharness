import { beforeEach, describe, expect, it } from "vitest";
import { isProviderLevelFailure, useProviderStore, type Connection } from "./providerStore";

/**
 * 2026-09-13 — a chat conversation that worked end-to-end (real replies,
 * twice) sat next to a composer chip reading "Anthropic · Not verified"
 * forever, because `health` only ever moved off the untested "setup"
 * default via an explicit Test click (`runProbe`). These tests pin the new
 * seam: a real run outcome is at least as strong evidence as a probe.
 */

function connection(overrides: Partial<Connection>): Connection {
  return {
    id: "an",
    provider: "anthropic",
    label: "Anthropic",
    residence: "cloud",
    endpoint: "https://api.anthropic.com",
    secret: null,
    health: "setup",
    detail: "Not connected.",
    probes: [],
    facts: [],
    models: [],
    defaultModel: "",
    enabled: true,
    lastProbe: "",
    ...overrides,
  };
}

function seed(overrides: Partial<Connection>) {
  useProviderStore.setState({ connections: [connection(overrides)] });
}

describe("isProviderLevelFailure", () => {
  it("recognises real auth/transport signatures — the same class runProbe()'s own catch block treats as fault", () => {
    expect(isProviderLevelFailure("401 invalid_api_key — the key was revoked or belongs to a deleted project.")).toBe(true);
    expect(isProviderLevelFailure("Request failed: connection refused")).toBe(true);
    expect(isProviderLevelFailure("ECONNREFUSED 127.0.0.1:11434")).toBe(true);
    expect(isProviderLevelFailure("getaddrinfo ENOTFOUND api.openai.com")).toBe(true);
    expect(isProviderLevelFailure("Request to Anthropic timed out after 60s")).toBe(true);
    expect(isProviderLevelFailure("403 Forbidden")).toBe(true);
  });

  it("does not flag resolver/config messages — those are graph/setup issues, not the vendor rejecting a call", () => {
    // Verbatim shapes from backend/providers/resolution.py's ProviderResolutionError.
    expect(isProviderLevelFailure("'OpenAI' is disconnected. Open Providers and enable it before running this harness.")).toBe(false);
    expect(isProviderLevelFailure("'Cursor' (Cursor) does not serve chat turns, so a llm node cannot target it.")).toBe(false);
    expect(isProviderLevelFailure("No provider is set for this node. Pin one on the node, or pick one from the chat provider chip and connect it under Providers.")).toBe(false);
    expect(isProviderLevelFailure("'Ollama Cloud' has no default model set. Open Providers and pick one for this connection.")).toBe(false);
  });

  it("does not flag ordinary content/tool failures unrelated to the connection", () => {
    expect(isProviderLevelFailure("The model returned invalid JSON for the requested tool call.")).toBe(false);
    expect(isProviderLevelFailure("Prompt exceeded the node's configured max tokens.")).toBe(false);
  });
});

describe("providerStore.reportRunOutcome", () => {
  beforeEach(() => {
    seed({});
  });

  it("a completed successful run marks the connection verified, even though no probe ever ran", () => {
    seed({ health: "setup", enabled: true });
    useProviderStore.getState().reportRunOutcome("an", { ok: true });
    expect(useProviderStore.getState().connections.find((c) => c.id === "an")?.health).toBe("live");
  });

  it("does not verify a connection the person has since disabled", () => {
    seed({ health: "setup", enabled: false });
    useProviderStore.getState().reportRunOutcome("an", { ok: true });
    expect(useProviderStore.getState().connections.find((c) => c.id === "an")?.health).toBe("setup");
  });

  it("does not stomp a probe already in flight", () => {
    seed({ health: "probing", enabled: true });
    useProviderStore.getState().reportRunOutcome("an", { ok: true });
    expect(useProviderStore.getState().connections.find((c) => c.id === "an")?.health).toBe("probing");
  });

  it("a genuine provider-level failure moves a previously-live connection to fault, with an honest detail", () => {
    seed({ health: "live", enabled: true, detail: "Signed in on the CLI." });
    useProviderStore.getState().reportRunOutcome("an", {
      ok: false,
      detail: "401 invalid_api_key — the key was revoked or belongs to a deleted project.",
    });
    const c = useProviderStore.getState().connections.find((x) => x.id === "an");
    expect(c?.health).toBe("fault");
    expect(c?.detail).toContain("401");
  });

  it("does not fault a connection the person has since disabled either", () => {
    seed({ health: "live", enabled: false, detail: "Credential removed." });
    useProviderStore.getState().reportRunOutcome("an", { ok: false, detail: "401 unauthorized" });
    const c = useProviderStore.getState().connections.find((x) => x.id === "an");
    expect(c?.health).toBe("live");
    expect(c?.detail).toBe("Credential removed.");
  });

  it("silently ignores a connection id nothing recognises", () => {
    const before = useProviderStore.getState().connections;
    useProviderStore.getState().reportRunOutcome("does-not-exist", { ok: true });
    expect(useProviderStore.getState().connections).toEqual(before);
  });
});
