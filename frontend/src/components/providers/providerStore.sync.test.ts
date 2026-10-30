import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProviderStore } from "./providerStore";

/** Store refresh: the list must converge on what the sidecar says. */
const initial = useProviderStore.getState();
const rows = (over: Record<string, unknown> = {}) => ({
  connections: [
    { id: "openrouter", provider: "openrouter", label: "OpenRouter", residence: "cloud", endpoint: "", enabled: true, secretRef: "oharness/openrouter", ...over },
  ],
});
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const find = () => useProviderStore.getState().connections.find((c) => c.id === "openrouter")!;

beforeEach(() => {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  useProviderStore.setState(initial, true);
});
afterEach(() => vi.unstubAllGlobals());

describe("providerStore.hydrate", () => {
  it("retries after a failed first attempt (sidecar still booting) instead of staying offline for the whole session", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED")).mockResolvedValue(ok(rows()));
    vi.stubGlobal("fetch", fetchMock);
    await useProviderStore.getState().hydrate();
    expect(find().enabled).toBe(false);
    await useProviderStore.getState().hydrate();
    expect(find().enabled).toBe(true);
  });

  it("retries after a non-OK response too", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) }).mockResolvedValue(ok(rows()));
    vi.stubGlobal("fetch", fetchMock);
    await useProviderStore.getState().hydrate();
    await useProviderStore.getState().hydrate();
    expect(find().enabled).toBe(true);
  });

  it("does not refetch once it has succeeded", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(rows()));
    vi.stubGlobal("fetch", fetchMock);
    await useProviderStore.getState().hydrate();
    await useProviderStore.getState().hydrate();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not leave a connection the sidecar says is on wearing the offline 'Not connected' sentence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(rows())));
    await useProviderStore.getState().hydrate();
    expect(find().enabled).toBe(true);
    expect(find().detail.startsWith("Not connected")).toBe(false);
  });
});

describe("providerStore.toggleEnabled", () => {
  const seedOff = () =>
    useProviderStore.setState((s) => ({
      connections: s.connections.map((c) => (c.id === "openrouter" ? { ...c, enabled: false } : c)),
    }));

  it("rolls the switch back when the sidecar refuses it, so the list never claims a state runs will not honour", async () => {
    seedOff();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) =>
        init?.method === "PUT" ? { ok: false, status: 500, json: async () => ({}) } : ok({}),
      ),
    );
    await useProviderStore.getState().toggleEnabled("openrouter");
    expect(find().enabled).toBe(false);
  });

  it("keeps the switch when the sidecar accepts it", async () => {
    seedOff();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({})));
    await useProviderStore.getState().toggleEnabled("openrouter");
    expect(find().enabled).toBe(true);
  });
});

describe("providerStore.loadState", () => {
  it("goes idle, loading, ready; and offline when the sidecar cannot be reached, then ready on a retry", async () => {
    expect(useProviderStore.getState().loadState).toBe("idle");
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED")).mockResolvedValue(ok(rows()));
    vi.stubGlobal("fetch", fetchMock);
    const first = useProviderStore.getState().hydrate();
    expect(useProviderStore.getState().loadState).toBe("loading");
    await first;
    expect(useProviderStore.getState().loadState).toBe("offline");
    await useProviderStore.getState().hydrate();
    expect(useProviderStore.getState().loadState).toBe("ready");
  });
});
