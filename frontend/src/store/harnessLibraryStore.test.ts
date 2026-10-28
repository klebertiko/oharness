import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_BUNDLE_ID,
  HARNESS_LIBRARY_KEY,
  useHarnessLibraryStore,
} from "./harnessLibraryStore";
import {
  HARNESS_SESSION_KEY,
  useHarnessSessionStore,
  type HarnessBundle,
} from "./harnessSessionStore";

const defaultBundle: HarnessBundle = {
  schemaVersion: "1.0.0",
  manifest: {
    id: DEFAULT_BUNDLE_ID,
    name: "OHarness Agile (skills-framework)",
    description: "Default agile harness",
  },
};

const customBundle: HarnessBundle = {
  schemaVersion: "1.0.0",
  manifest: {
    id: "oharness.custom.demo",
    name: "Custom Demo",
    description: "Imported harness",
  },
};

describe("harnessLibraryStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useHarnessLibraryStore.setState({ entries: [], hydrated: false });
    useHarnessSessionStore.setState({
      enabled: true,
      activeBundle: null,
      hydrated: false,
    });
    vi.restoreAllMocks();
  });

  it("a failed hydrate is recorded so callers can stop waiting, and a retry clears it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(useHarnessLibraryStore.getState().hydrate()).rejects.toThrow();
    expect(useHarnessLibraryStore.getState()).toMatchObject({ failed: true, hydrated: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ manifest: { id: "oharness.default.agile", name: "Agile" } }) }));
    await useHarnessLibraryStore.getState().hydrate();
    expect(useHarnessLibraryStore.getState()).toMatchObject({ failed: false, hydrated: true });
  });

  it("hydrate always includes default from /bundles/default", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => defaultBundle,
      })
    );

    await useHarnessLibraryStore.getState().hydrate();

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:8000/bundles/default", { cache: "no-store" });
    const { entries, hydrated } = useHarnessLibraryStore.getState();
    expect(hydrated).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(DEFAULT_BUNDLE_ID);
    expect(entries[0].isDefault).toBe(true);
  });

  it("importBundle adds an entry and persists to localStorage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => defaultBundle,
      })
    );
    await useHarnessLibraryStore.getState().hydrate();

    useHarnessLibraryStore.getState().importBundle(customBundle);

    const { entries } = useHarnessLibraryStore.getState();
    expect(entries.map((e) => e.id)).toEqual([
      DEFAULT_BUNDLE_ID,
      "oharness.custom.demo",
    ]);

    const raw = localStorage.getItem(HARNESS_LIBRARY_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.imports).toHaveLength(1);
    expect(parsed.imports[0].id).toBe("oharness.custom.demo");
  });

  it("hydrate restores persisted imports after default", async () => {
    localStorage.setItem(
      HARNESS_LIBRARY_KEY,
      JSON.stringify({
        imports: [
          {
            id: customBundle.manifest.id,
            name: customBundle.manifest.name,
            description: customBundle.manifest.description,
            bundle: customBundle,
            addedAt: 100,
          },
        ],
      })
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => defaultBundle,
      })
    );

    await useHarnessLibraryStore.getState().hydrate();

    expect(useHarnessLibraryStore.getState().entries.map((e) => e.id)).toEqual([
      DEFAULT_BUNDLE_ID,
      "oharness.custom.demo",
    ]);
  });

  it("activate calls replaceBundle and setEnabled(true)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => defaultBundle,
      })
    );
    await useHarnessLibraryStore.getState().hydrate();
    useHarnessLibraryStore.getState().importBundle(customBundle);
    useHarnessSessionStore.getState().setEnabled(false);

    useHarnessLibraryStore.getState().activate("oharness.custom.demo");

    const session = useHarnessSessionStore.getState();
    expect(session.enabled).toBe(true);
    expect(session.activeBundle?.manifest.id).toBe("oharness.custom.demo");
    expect(JSON.parse(localStorage.getItem(HARNESS_SESSION_KEY)!)).toMatchObject({
      enabled: true,
      activeBundleId: "oharness.custom.demo",
    });
  });

  it("importBundle ignores the default id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => defaultBundle,
      })
    );
    await useHarnessLibraryStore.getState().hydrate();

    useHarnessLibraryStore.getState().importBundle({
      ...defaultBundle,
      manifest: { ...defaultBundle.manifest, name: "Forged name" },
    });

    expect(useHarnessLibraryStore.getState().entries).toHaveLength(1);
    expect(useHarnessLibraryStore.getState().entries[0].name).toBe(
      "OHarness Agile (skills-framework)"
    );
  });

  it("remove cannot drop the default entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => defaultBundle,
      })
    );
    await useHarnessLibraryStore.getState().hydrate();
    useHarnessLibraryStore.getState().importBundle(customBundle);

    useHarnessLibraryStore.getState().remove(DEFAULT_BUNDLE_ID);
    useHarnessLibraryStore.getState().remove("oharness.custom.demo");

    expect(useHarnessLibraryStore.getState().entries.map((e) => e.id)).toEqual([
      DEFAULT_BUNDLE_ID,
    ]);
  });
});
