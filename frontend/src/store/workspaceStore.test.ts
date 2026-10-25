import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoworkProject } from "@/lib/coworkApi";
import {
  WORKSPACE_STORAGE_KEY,
  chosenWorkspace,
  useWorkspaceStore,
} from "./workspaceStore";

const projectA: CoworkProject = {
  id: "a",
  name: "Project A",
  rootPath: "D:\\Development\\src\\OHarness",
  instructions: "",
  memoryJson: {},
  harnessBundleId: null,
  harnessEnabled: true,
};

const projectB: CoworkProject = {
  id: "b",
  name: "Project B",
  rootPath: "D:\\Development\\src\\onipresentia",
  instructions: "",
  memoryJson: {},
  harnessBundleId: null,
  harnessEnabled: true,
};

describe("workspaceStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkspaceStore.setState({
      projects: [],
      hydrated: false,
      chosenProjectId: null,
    });
    vi.restoreAllMocks();
  });

  it("hydrate fetches /cowork/projects and populates projects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ projects: [projectA, projectB] }),
      })
    );

    await useWorkspaceStore.getState().hydrate();

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/cowork/projects",
      expect.anything()
    );
    expect(useWorkspaceStore.getState().projects).toEqual([projectA, projectB]);
    expect(useWorkspaceStore.getState().hydrated).toBe(true);
  });

  it("hydrate is a no-op once already hydrated", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ projects: [projectA] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await useWorkspaceStore.getState().hydrate();
    await useWorkspaceStore.getState().hydrate();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refresh degrades silently when the sidecar is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(useWorkspaceStore.getState().refresh()).resolves.toBeUndefined();
    expect(useWorkspaceStore.getState().projects).toEqual([]);
  });

  it("setChosen updates chosenProjectId and persists only that field", () => {
    useWorkspaceStore.getState().setChosen("a");
    expect(useWorkspaceStore.getState().chosenProjectId).toBe("a");

    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).state).toEqual({ chosenProjectId: "a" });
  });

  it("chosenWorkspace resolves null when nothing is chosen", () => {
    expect(chosenWorkspace(useWorkspaceStore.getState())).toBeNull();
  });

  it("chosenWorkspace resolves the matching project", () => {
    useWorkspaceStore.setState({ projects: [projectA, projectB], chosenProjectId: "b" });
    expect(chosenWorkspace(useWorkspaceStore.getState())).toEqual(projectB);
  });

  it("chosenWorkspace degrades to null for a stale/deleted id", () => {
    // The project list is always refetched fresh (never trusted from a
    // stale cache) — a project removed elsewhere since it was picked must
    // read as "no folder", not throw or resurrect a dangling reference.
    useWorkspaceStore.setState({ projects: [projectA], chosenProjectId: "deleted-project" });
    expect(chosenWorkspace(useWorkspaceStore.getState())).toBeNull();
  });

  it("addProject posts to /cowork/projects, prepends the result and selects it", async () => {
    const created: CoworkProject = {
      id: "c",
      name: "OHarness",
      rootPath: "D:\\Development\\src\\OHarness",
      instructions: "",
      memoryJson: {},
      harnessBundleId: null,
      harnessEnabled: true,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => created,
    });
    vi.stubGlobal("fetch", fetchMock);
    useWorkspaceStore.setState({ projects: [projectA] });

    const id = await useWorkspaceStore
      .getState()
      .addProject({ name: "OHarness", rootPath: "D:\\Development\\src\\OHarness" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/cowork/projects",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "OHarness", rootPath: "D:\\Development\\src\\OHarness" }),
      })
    );
    expect(id).toBe("c");
    expect(useWorkspaceStore.getState().projects).toEqual([created, projectA]);
    expect(useWorkspaceStore.getState().chosenProjectId).toBe("c");
  });

  it("addProject returns null and changes nothing when the sidecar rejects it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" }));
    useWorkspaceStore.setState({ projects: [projectA], chosenProjectId: "a" });

    const id = await useWorkspaceStore.getState().addProject({ name: "X", rootPath: "/x" });

    expect(id).toBeNull();
    expect(useWorkspaceStore.getState().projects).toEqual([projectA]);
    expect(useWorkspaceStore.getState().chosenProjectId).toBe("a");
  });
});
