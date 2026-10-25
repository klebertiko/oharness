import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProviderStore } from "./providerStore";
import { saveSecret } from "./secrets";

/* providers-recovery: every setting the Providers screen shows must be the
   one the sidecar runs with. F3 (endpoint never saved), F4 (fabricated model
   list), F5 (no writer for defaultModel), F10 (Remove key left the key in the
   SecretsStore; plaintext kept in renderer memory when the sidecar is down). */

const initial = useProviderStore.getState();
const ok = (body: unknown = {}) => ({ ok: true, status: 200, json: async () => body });
const fail = (status = 500) => ({ ok: false, status, json: async () => ({}) });
const find = (id: string) => useProviderStore.getState().connections.find((c) => c.id === id)!;

type Call = [string, RequestInit | undefined];
const callsTo = (fetchMock: ReturnType<typeof vi.fn>, fragment: string, method: string) =>
  (fetchMock.mock.calls as Call[]).filter(([url, init]) => String(url).includes(fragment) && (init?.method ?? "GET") === method);

beforeEach(() => {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  useProviderStore.setState(initial, true);
});
afterEach(() => vi.unstubAllGlobals());

describe("defaultModel (F5)", () => {
  it("hydrates the connection's default model from the sidecar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({
      connections: [{ id: "ollama-local", provider: "ollama", label: "Ollama local", residence: "local", endpoint: "http://127.0.0.1:11434/v1", enabled: true, secretRef: null, defaultModel: "gemma4:26b" }],
    })));
    await useProviderStore.getState().hydrate();
    expect(find("ollama-local").defaultModel).toBe("gemma4:26b");
  });

  it("persists a chosen default model with PUT and reports success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchMock);
    await expect(useProviderStore.getState().setDefaultModel("ollama-local", "gemma4:26b")).resolves.toBe(true);
    expect(find("ollama-local").defaultModel).toBe("gemma4:26b");
    const [, init] = callsTo(fetchMock, "/providers/connections/ollama-local", "PUT")[0];
    expect(JSON.parse(String(init?.body))).toEqual({ defaultModel: "gemma4:26b" });
  });

  it("rolls back and reports failure when the sidecar refuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_u: string, init?: RequestInit) =>
      Promise.resolve(init?.method === "PUT" ? fail() : ok())));
    await expect(useProviderStore.getState().setDefaultModel("ollama-local", "gemma4:26b")).resolves.toBe(false);
    expect(find("ollama-local").defaultModel).toBe("");
  });
});

describe("endpoint (F3)", () => {
  it("persists an edited endpoint so the next probe uses it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchMock);
    await expect(useProviderStore.getState().saveEndpoint("ollama-local", "http://127.0.0.1:11500/v1")).resolves.toBe(true);
    expect(find("ollama-local").endpoint).toBe("http://127.0.0.1:11500/v1");
    const [, init] = callsTo(fetchMock, "/providers/connections/ollama-local", "PUT")[0];
    expect(JSON.parse(String(init?.body))).toEqual({ endpoint: "http://127.0.0.1:11500/v1" });
  });

  it("keeps the saved endpoint when the sidecar refuses the change", async () => {
    const before = find("ollama-local").endpoint;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_u: string, init?: RequestInit) =>
      Promise.resolve(init?.method === "PUT" ? fail() : ok())));
    await expect(useProviderStore.getState().saveEndpoint("ollama-local", "http://bad")).resolves.toBe(false);
    expect(find("ollama-local").endpoint).toBe(before);
  });
});

describe("probe models (F4)", () => {
  it("replaces the catalog list with the ids the endpoint actually serves", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) =>
      Promise.resolve(String(url).endsWith("/probe")
        ? ok({ ok: true, health: "live", detail: "2 models available.", latencyMs: 4, facts: [], models: ["gemma4:26b", "nomic-embed-text:latest"] })
        : ok())));
    await useProviderStore.getState().probe("ollama-local");
    const c = find("ollama-local");
    expect(c.models.map((m) => m.id)).toEqual(["gemma4:26b", "nomic-embed-text:latest"]);
    expect(c.modelsFromEndpoint).toBe(true);
  });

  it("keeps the catalog (marked as such) when the probe reports no list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) =>
      Promise.resolve(String(url).endsWith("/probe")
        ? ok({ ok: true, health: "live", detail: "Logged in.", latencyMs: 4, facts: [] })
        : ok())));
    const before = find("anthropic").models.length;
    await useProviderStore.getState().probe("anthropic");
    expect(find("anthropic").models.length).toBe(before);
    expect(find("anthropic").modelsFromEndpoint).toBeFalsy();
  });
});

describe("secrets (F10)", () => {
  it("Remove key deletes the stored key in the sidecar", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    useProviderStore.setState((s) => ({
      connections: s.connections.map((c) => (c.id === "openrouter"
        ? { ...c, enabled: true, secret: { service: "oharness/openrouter", prefix: "", tail: "····", length: 0, vault: "backend", savedAt: "" } }
        : c)),
    }));
    await expect(useProviderStore.getState().revokeSecret("openrouter")).resolves.toBe(true);
    expect(callsTo(fetchMock, "/providers/openrouter/secret", "DELETE")).toHaveLength(1);
    expect(find("openrouter").secret).toBeNull();
    expect(find("openrouter").enabled).toBe(false);
  });

  it("Remove key that the sidecar could not delete keeps the key shown and reports failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fail()));
    const secret = { service: "oharness/openrouter", prefix: "", tail: "····", length: 0, vault: "backend" as const, savedAt: "" };
    useProviderStore.setState((s) => ({
      connections: s.connections.map((c) => (c.id === "openrouter" ? { ...c, enabled: true, secret } : c)),
    }));
    await expect(useProviderStore.getState().revokeSecret("openrouter")).resolves.toBe(false);
    expect(find("openrouter").secret).toEqual(secret);
  });

  it("never keeps a pasted key in renderer memory when the sidecar is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(saveSecret("oharness/openrouter", "sk-or-test-value-1234")).rejects.toThrow(/couldn't reach/i);
  });
});

describe("seed endpoints (F12)", () => {
  it("Ollama local starts on the OpenAI-compatible path the adapter probes (/v1), not the bare daemon root", async () => {
    const { PROVIDERS } = await import("./catalog");
    expect(find("ollama-local").endpoint).toBe(PROVIDERS.ollama.endpoint.default);
    expect(find("ollama-local").endpoint.endsWith("/v1")).toBe(true);
  });
});
