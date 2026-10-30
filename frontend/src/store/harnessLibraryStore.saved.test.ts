import { beforeEach, describe, expect, it, vi } from "vitest";

import { useStudioDocsStore } from "@/lib/studioDocuments";
import { DEFAULT_BUNDLE_ID, HARNESS_LIBRARY_KEY, mergeLibrary, useHarnessLibraryStore } from "./harnessLibraryStore";
import { useHarnessSessionStore, type HarnessBundle } from "./harnessSessionStore";

const defaultBundle: HarnessBundle = { manifest: { id: DEFAULT_BUNDLE_ID, name: "Agile" } };
const imported = (id: string, name: string): HarnessBundle => ({ manifest: { id, name, description: "Imported." } });
const meta = (id: string, name: string, updated = "2026-01-01T00:00:00") => ({ id, name, description: `About ${name}`, created_at: "2026-01-01T00:00:00", updated_at: updated });
const row = (b: HarnessBundle) => ({ id: b.manifest.id, name: b.manifest.name ?? b.manifest.id, bundle: b, addedAt: 1 });
const node = { id: "n1", type: "agent", position: { x: 0, y: 0 }, data: { label: "Reply", providerIds: [] } };

/** What the stub database says about every record's last save. */
const server = { updated: "2026-01-01T00:00:00" };

function serve(over: { list?: () => Response | Promise<Response>; get?: (id: string) => Response | Promise<Response> } = {}) {
  const fetchMock = vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    if (path === "/bundles/default") return Response.json(defaultBundle);
    if (path === "/harnesses/") return over.list ? over.list() : Response.json([]);
    const id = path.split("/").pop() as string;
    return over.get ? over.get(id) : Response.json({ ...meta(id, "Mine", server.updated), graph_json: { nodes: [node], edges: [] } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  server.updated = "2026-01-01T00:00:00";
  useHarnessLibraryStore.setState({ entries: [], imports: [], saved: [], hydrated: false, failed: false, savedFailed: false, activateFailed: null });
  useStudioDocsStore.setState({ items: [], loaded: false, error: "" });
  useHarnessSessionStore.setState({ enabled: false, activeBundle: null, hydrated: true });
});

describe("mergeLibrary", () => {
  it("lists the default first, then saved and imported together by name", () => {
    const entries = mergeLibrary(defaultBundle, [meta("s1", "zeta"), meta("s2", "Alpha")], [row(imported("i1", "Mid"))]);
    expect(entries.map((e) => [e.name, e.source])).toEqual([
      ["Agile", "bundled"],
      ["Alpha", "saved"],
      ["Mid", "imported"],
      ["zeta", "saved"],
    ]);
  });

  it("is stable whatever order the sources answer in, and breaks name ties by id", () => {
    const a = mergeLibrary(defaultBundle, [meta("b", "Same"), meta("a", "Same")], []);
    const b = mergeLibrary(defaultBundle, [meta("a", "Same"), meta("b", "Same")], []);
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
    expect(a.map((e) => e.id)).toEqual([DEFAULT_BUNDLE_ID, "a", "b"]);
  });

  it("does not list one id twice: default > saved > imported", () => {
    const entries = mergeLibrary(
      defaultBundle,
      [meta(DEFAULT_BUNDLE_ID, "Spoof"), meta("dup", "Saved wins")],
      [row(imported("dup", "Imported loses")), row(imported(DEFAULT_BUNDLE_ID, "Spoof 2"))],
    );
    expect(entries.map((e) => [e.id, e.name, e.source])).toEqual([
      [DEFAULT_BUNDLE_ID, "Agile", "bundled"],
      ["dup", "Saved wins", "saved"],
    ]);
  });
});

describe("hydrate with saved harnesses", () => {
  it("lists created and saved harnesses beside the imported ones", async () => {
    localStorage.setItem(HARNESS_LIBRARY_KEY, JSON.stringify({ imports: [row(imported("i1", "Imported"))] }));
    serve({ list: () => Response.json([meta("s1", "Mine")]) });
    await useHarnessLibraryStore.getState().hydrate();
    const s = useHarnessLibraryStore.getState();
    expect(s.entries.map((e) => e.id)).toEqual([DEFAULT_BUNDLE_ID, "i1", "s1"]);
    expect(s).toMatchObject({ hydrated: true, failed: false, savedFailed: false });
    expect(s.entries.find((e) => e.id === "s1")).toMatchObject({ source: "saved", description: "About Mine", isDefault: false });
  });

  it("never persists saved harnesses as imports", async () => {
    serve({ list: () => Response.json([meta("s1", "Mine")]) });
    await useHarnessLibraryStore.getState().hydrate();
    expect(JSON.parse(localStorage.getItem(HARNESS_LIBRARY_KEY) ?? "{}").imports).toEqual([]);
  });

  it("a failing list is reported, not an empty list: the rest stays and a retry recovers", async () => {
    localStorage.setItem(HARNESS_LIBRARY_KEY, JSON.stringify({ imports: [row(imported("i1", "Imported"))] }));
    serve({ list: () => new Response("down", { status: 503 }) });
    await useHarnessLibraryStore.getState().hydrate();
    expect(useHarnessLibraryStore.getState()).toMatchObject({ hydrated: true, savedFailed: true });
    expect(useHarnessLibraryStore.getState().entries.map((e) => e.id)).toEqual([DEFAULT_BUNDLE_ID, "i1"]);

    serve({ list: () => Response.json([meta("s1", "Mine")]) });
    await useHarnessLibraryStore.getState().hydrate();
    expect(useHarnessLibraryStore.getState()).toMatchObject({ savedFailed: false });
    expect(useHarnessLibraryStore.getState().entries.map((e) => e.id)).toEqual([DEFAULT_BUNDLE_ID, "i1", "s1"]);
  });

  it("a failed refresh keeps the saved harnesses already known", async () => {
    serve({ list: () => Response.json([meta("s1", "Mine")]) });
    await useHarnessLibraryStore.getState().hydrate();
    serve({ list: () => new Response("down", { status: 503 }) });
    await useHarnessLibraryStore.getState().hydrate();
    expect(useHarnessLibraryStore.getState().entries.map((e) => e.id)).toContain("s1");
    expect(useHarnessLibraryStore.getState().savedFailed).toBe(true);
  });

  it("an import that is removed stays removed; a shadowed import returns when the saved one goes", async () => {
    localStorage.setItem(HARNESS_LIBRARY_KEY, JSON.stringify({ imports: [row(imported("dup", "Imported")), row(imported("gone", "Gone"))] }));
    serve({ list: () => Response.json([meta("dup", "Saved")]) });
    await useHarnessLibraryStore.getState().hydrate();
    useHarnessLibraryStore.getState().remove("gone");
    expect(useHarnessLibraryStore.getState().entries.map((e) => e.id)).toEqual([DEFAULT_BUNDLE_ID, "dup"]);
    useHarnessLibraryStore.getState().applySaved([]);
    expect(useHarnessLibraryStore.getState().entries.map((e) => [e.id, e.source])).toEqual([[DEFAULT_BUNDLE_ID, "bundled"], ["dup", "imported"]]);
  });
});

describe("following Studio without a reload", () => {
  it("a save, rename and delete in Studio change the list", async () => {
    serve();
    await useHarnessLibraryStore.getState().hydrate();
    useStudioDocsStore.setState({ items: [meta("s1", "First")] });
    expect(useHarnessLibraryStore.getState().entries.map((e) => e.name)).toEqual(["Agile", "First"]);
    useStudioDocsStore.setState({ items: [meta("s1", "Renamed", "2026-01-02T00:00:00")] });
    expect(useHarnessLibraryStore.getState().entries.map((e) => e.name)).toEqual(["Agile", "Renamed"]);
    useStudioDocsStore.setState({ items: [] });
    expect(useHarnessLibraryStore.getState().entries.map((e) => e.name)).toEqual(["Agile"]);
  });

  it("ignores Studio's list while Studio itself could not read it", async () => {
    serve({ list: () => Response.json([meta("s1", "First")]) });
    await useHarnessLibraryStore.getState().hydrate();
    useStudioDocsStore.setState({ items: [], error: "offline" });
    expect(useHarnessLibraryStore.getState().entries.map((e) => e.id)).toContain("s1");
  });

  it("runs the saved copy of the harness in use after it is saved again", async () => {
    const fetchMock = serve({ list: () => Response.json([meta("s1", "Mine")]) });
    await useHarnessLibraryStore.getState().hydrate();
    await useHarnessLibraryStore.getState().activate("s1");
    expect(useHarnessSessionStore.getState().activeBundle?.manifest.updatedAt).toBe("2026-01-01T00:00:00");
    fetchMock.mockClear();
    server.updated = "2026-02-02T00:00:00";
    useStudioDocsStore.setState({ items: [meta("s1", "Mine", "2026-02-02T00:00:00")] });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(useHarnessSessionStore.getState().activeBundle?.manifest.updatedAt).toBe("2026-02-02T00:00:00"));
  });
});

describe("activate", () => {
  it("fetches a saved harness's graph and puts it in use as the bundle the chat runs", async () => {
    const fetchMock = serve({ list: () => Response.json([meta("s1", "Mine")]) });
    await useHarnessLibraryStore.getState().hydrate();
    expect(await useHarnessLibraryStore.getState().activate("s1")).toBe(true);
    expect(fetchMock.mock.calls.map((c) => new URL(c[0] as string).pathname)).toContain("/harnesses/s1");
    const session = useHarnessSessionStore.getState();
    expect(session.enabled).toBe(true);
    expect(session.activeBundle?.manifest).toMatchObject({ id: "s1", name: "Mine" });
    expect(session.activeBundle?.graph?.nodes).toHaveLength(1);
  });

  it("a graph that can't be loaded leaves the session as it was and says which harness failed", async () => {
    serve({ list: () => Response.json([meta("s1", "Mine")]), get: () => new Response("nope", { status: 500 }) });
    await useHarnessLibraryStore.getState().hydrate();
    expect(await useHarnessLibraryStore.getState().activate("s1")).toBe(false);
    expect(useHarnessSessionStore.getState().activeBundle).toBeNull();
    expect(useHarnessLibraryStore.getState().activateFailed).toEqual({ id: "s1", name: "Mine" });
  });

  it("a record with no graph is a failure, not an empty harness", async () => {
    serve({ list: () => Response.json([meta("s1", "Mine")]), get: () => Response.json({ ...meta("s1", "Mine"), graph_json: null }) });
    await useHarnessLibraryStore.getState().hydrate();
    expect(await useHarnessLibraryStore.getState().activate("s1")).toBe(false);
  });

  it("the newest pick wins when two overlap", async () => {
    let release: (r: Response) => void = () => undefined;
    serve({
      list: () => Response.json([meta("slow", "Slow"), meta("fast", "Fast")]),
      get: (id) => (id === "slow" ? new Promise<Response>((r) => { release = r; }) : Response.json({ ...meta("fast", "Fast"), graph_json: { nodes: [node], edges: [] } })),
    });
    await useHarnessLibraryStore.getState().hydrate();
    const slow = useHarnessLibraryStore.getState().activate("slow");
    await useHarnessLibraryStore.getState().activate("fast");
    release(Response.json({ ...meta("slow", "Slow"), graph_json: { nodes: [node], edges: [] } }));
    expect(await slow).toBe(false);
    expect(useHarnessSessionStore.getState().activeBundle?.manifest.id).toBe("fast");
  });

  it("a bundled or imported harness still activates at once", async () => {
    localStorage.setItem(HARNESS_LIBRARY_KEY, JSON.stringify({ imports: [row(imported("i1", "Imported"))] }));
    serve();
    await useHarnessLibraryStore.getState().hydrate();
    void useHarnessLibraryStore.getState().activate("i1");
    expect(useHarnessSessionStore.getState().activeBundle?.manifest.id).toBe("i1");
  });
});
