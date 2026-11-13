import { beforeEach, describe, expect, it, vi } from "vitest";
import { providerFault } from "../agent/chatProvider";
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

describe("detection never outranks a newer result", () => {
  const anthropic = () => useProviderStore.getState().connections.find((c) => c.provider === "anthropic")!;
  const setAnthropic = (over: object) =>
    useProviderStore.setState((s) => ({ connections: s.connections.map((c) => (c.provider === "anthropic" ? { ...c, ...over } : c)) }));

  it("a run that fails with cli-signin replaces an older not-installed detection", () => {
    setAnthropic({ enabled: true, health: "setup", cliState: "not-installed" });
    useProviderStore.getState().reportRunOutcome(anthropic().id, { ok: false, detail: "x", cliFailure: "cli-signin" });
    expect(providerFault(anthropic())).toBe("cli-signin");
  });

  it("a successful run drops the detection too", () => {
    setAnthropic({ enabled: true, health: "setup", cliState: "not-logged-in" });
    useProviderStore.getState().reportRunOutcome(anthropic().id, { ok: true });
    expect(anthropic().cliState).toBeUndefined();
  });

  it("an answer that arrives after a Test does not bring the old state back", async () => {
    let release: (v: unknown) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise((r) => { release = r; })));
    const pending = useProviderStore.getState().detectClis();
    setAnthropic({ enabled: true, health: "setup", cliState: undefined });
    // a Test starts and clears detection for that connection
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
    await useProviderStore.getState().probe(anthropic().id);
    release(reply([{ id: "claude", provider: "anthropic", state: "not-installed" }]));
    await pending;
    expect(anthropic().cliState).toBeUndefined();
  });
});
