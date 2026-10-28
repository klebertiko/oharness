import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HARNESS_SESSION_KEY,
  useHarnessSessionStore,
  type HarnessBundle,
} from "./harnessSessionStore";

const defaultBundle: HarnessBundle = {
  manifest: { id: "skills-framework-agile" },
};

const otherBundle: HarnessBundle = {
  manifest: { id: "custom-harness" },
};

describe("harnessSessionStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useHarnessSessionStore.setState({
      enabled: true,
      activeBundle: null,
      hydrated: false,
    });
    vi.restoreAllMocks();
  });

  it("setEnabled toggles harness on and off", () => {
    const { setEnabled } = useHarnessSessionStore.getState();
    setEnabled(false);
    expect(useHarnessSessionStore.getState().enabled).toBe(false);
    setEnabled(true);
    expect(useHarnessSessionStore.getState().enabled).toBe(true);
  });

  it("replaceBundle sets activeBundle", () => {
    useHarnessSessionStore.getState().replaceBundle(otherBundle);
    expect(useHarnessSessionStore.getState().activeBundle).toEqual(otherBundle);
  });

  it("setActiveBundle sets activeBundle", () => {
    useHarnessSessionStore.getState().setActiveBundle(defaultBundle);
    expect(useHarnessSessionStore.getState().activeBundle).toEqual(defaultBundle);
  });

  it("persists enabled and activeBundleId to localStorage", () => {
    useHarnessSessionStore.getState().setEnabled(false);
    useHarnessSessionStore.getState().replaceBundle(otherBundle);

    const raw = localStorage.getItem(HARNESS_SESSION_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({
      enabled: false,
      activeBundleId: "custom-harness",
    });
  });

  it("hydrate loads default bundle from /bundles/default", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => defaultBundle,
      })
    );

    await useHarnessSessionStore.getState().hydrate();

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:8000/bundles/default");
    expect(useHarnessSessionStore.getState().activeBundle).toEqual(defaultBundle);
    expect(useHarnessSessionStore.getState().hydrated).toBe(true);
  });

  it("hydrate does not overwrite a harness put in use while the default was loading", async () => {
    let release: (v: unknown) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { release = resolve; })));
    const pending = useHarnessSessionStore.getState().hydrate();
    useHarnessSessionStore.getState().replaceBundle({ manifest: { id: "chosen", name: "Chosen" } });
    release({ ok: true, json: async () => defaultBundle });
    await pending;
    expect(useHarnessSessionStore.getState().activeBundle?.manifest.id).toBe("chosen");
    expect(useHarnessSessionStore.getState().hydrated).toBe(true);
  });

  it("hydrate restores enabled from localStorage", async () => {
    localStorage.setItem(
      HARNESS_SESSION_KEY,
      JSON.stringify({ enabled: false, activeBundleId: "skills-framework-agile" })
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => defaultBundle,
      })
    );

    await useHarnessSessionStore.getState().hydrate();

    expect(useHarnessSessionStore.getState().enabled).toBe(false);
    expect(useHarnessSessionStore.getState().activeBundle?.manifest.id).toBe(
      "skills-framework-agile"
    );
  });

  it("hydrate keeps a harness the person already put in use (Studio 'Use in chat' then chat mounts)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(defaultBundle), { status: 200 }),
    );
    // Studio composed the sample and activated it before the chat ever hydrated.
    useHarnessSessionStore.getState().replaceBundle(otherBundle);
    await useHarnessSessionStore.getState().hydrate();
    expect(useHarnessSessionStore.getState().activeBundle).toEqual(otherBundle);
    expect(useHarnessSessionStore.getState().hydrated).toBe(true);
  });
});
