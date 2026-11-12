import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProviderStore } from "./providerStore";

const initial = useProviderStore.getState();
const reply = (clis: unknown[]) => ({ ok: true, status: 200, json: async () => ({ clis }) });

beforeEach(() => {
  useProviderStore.setState(initial, true);
  vi.unstubAllGlobals();
});

const stateOf = (provider: string) => useProviderStore.getState().connections.find((c) => c.provider === provider)?.cliState;

describe("detectClis (GET /providers/clis)", () => {
  it("copies each CLI's state onto the connection that uses it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply([
      { id: "claude", provider: "anthropic", state: "not-installed" },
      { id: "codex", provider: "openai", state: "not-logged-in" },
      { id: "cursor", provider: "cursor", state: "ready" },
    ])));
    await useProviderStore.getState().detectClis();
    expect(stateOf("anthropic")).toBe("not-installed");
    expect(stateOf("openai")).toBe("not-logged-in");
    expect(stateOf("cursor")).toBe("ready");
  });

  it("ignores unknown states and leaves everything alone when the sidecar fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply([{ id: "claude", provider: "anthropic", state: "weird" }])));
    await useProviderStore.getState().detectClis();
    expect(stateOf("anthropic")).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    await expect(useProviderStore.getState().detectClis()).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
    await useProviderStore.getState().detectClis();
    expect(stateOf("anthropic")).toBeUndefined();
  });
});
