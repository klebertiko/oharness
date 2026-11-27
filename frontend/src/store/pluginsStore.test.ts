import { beforeEach, describe, expect, it } from "vitest";
import { calls, plugin, routes, serveFetch, useSidecarStub } from "@/components/plugins/testKit";
import { usePluginsStore } from "./pluginsStore";

const running = { state: "running", reason: null, restarts: 0, node: "22.20.0", hostLog: [], plugins: 1 };
const id = "0123456789abcdef";

describe("pluginsStore", () => {
  useSidecarStub();
  beforeEach(() => usePluginsStore.getState().reset());

  it("loads status and plugins, ready when both answer", async () => {
    routes.set("GET /cordis/status", { body: running });
    routes.set("GET /cordis/plugins", { body: { plugins: [plugin()] } });
    expect(usePluginsStore.getState().phase).toBe("loading");
    await usePluginsStore.getState().load();
    const s = usePluginsStore.getState();
    expect([s.phase, s.status?.state, s.plugins.length]).toEqual(["ready", "running", 1]);
  });

  it("is error when the engine does not answer, and keeps the old list on a failed refresh", async () => {
    await usePluginsStore.getState().load();
    expect(usePluginsStore.getState().phase).toBe("error");
    routes.set("GET /cordis/status", { body: running });
    routes.set("GET /cordis/plugins", { body: { plugins: [plugin()] } });
    await usePluginsStore.getState().load();
    routes.clear();
    await usePluginsStore.getState().load();
    expect(usePluginsStore.getState().phase).toBe("ready");
    expect(usePluginsStore.getState().plugins).toHaveLength(1);
    expect(usePluginsStore.getState().refreshError).not.toBeNull();
  });

  it("shows a host that is unavailable as ready with its reason, not as an error", async () => {
    routes.set("GET /cordis/status", { body: { ...running, state: "unavailable", reason: "Node.js was not found; plugins are off." } });
    routes.set("GET /cordis/plugins", { status: 503, body: { detail: { code: "cordis_unavailable", state: "unavailable", message: "x" } } });
    await usePluginsStore.getState().load();
    expect(usePluginsStore.getState().phase).toBe("ready");
    expect(usePluginsStore.getState().status?.reason).toContain("Node.js");
  });

  it("toggles a plugin, replaces it by the answer, and reports 403 human_only as an action error", async () => {
    routes.set("GET /cordis/status", { body: running });
    routes.set("GET /cordis/plugins", { body: { plugins: [plugin()] } });
    await usePluginsStore.getState().load();
    routes.set(`POST /cordis/plugins/${id}/disable`, { body: plugin({ enabled: false, state: "disabled" }) });
    await usePluginsStore.getState().toggle(id, false);
    expect(usePluginsStore.getState().plugins[0].state).toBe("disabled");
    routes.set(`POST /cordis/plugins/${id}/enable`, { status: 403, body: { detail: { code: "human_only", message: "no" } } });
    await usePluginsStore.getState().toggle(id, true);
    expect(usePluginsStore.getState().actionError?.code).toBe("human_only");
    expect(usePluginsStore.getState().plugins[0].state).toBe("disabled");
  });

  it("removes a plugin and clears the selection", async () => {
    routes.set("GET /cordis/status", { body: running });
    routes.set("GET /cordis/plugins", { body: { plugins: [plugin()] } });
    await usePluginsStore.getState().load();
    usePluginsStore.getState().select(id);
    routes.set(`DELETE /cordis/plugins/${id}`, { status: 204 });
    await usePluginsStore.getState().remove(id);
    expect(usePluginsStore.getState().plugins).toEqual([]);
    expect(usePluginsStore.getState().selectedId).toBeNull();
  });

  it("loads logs for the selected plugin", async () => {
    routes.set(`GET /cordis/plugins/${id}/logs`, { body: { lines: ["[plugin notes-tool] hi"] } });
    await usePluginsStore.getState().loadLogs(id);
    expect(usePluginsStore.getState().logs).toEqual({ id, lines: ["[plugin notes-tool] hi"], loading: false, error: null });
  });

  it("walks add: fetch to preview, install only with the confirmation, then done", async () => {
    routes.set("GET /cordis/status", { body: running });
    routes.set("GET /cordis/plugins", { body: { plugins: [] } });
    serveFetch();
    routes.set("POST /cordis/plugins/install", { body: plugin({ state: "active" }) });
    await usePluginsStore.getState().fetchPackage({ kind: "npm", spec: "notes-tool", version: "1.2.0" });
    expect(usePluginsStore.getState().add.step).toBe("preview");
    await usePluginsStore.getState().install(false);
    expect(calls.filter((c) => c.path.endsWith("/install"))).toHaveLength(0);
    usePluginsStore.getState().decideScript("fedcba9876543210", "d".repeat(64), "postinstall", "accept");
    await usePluginsStore.getState().install(true);
    expect(usePluginsStore.getState().add.step).toBe("done");
    expect(calls.find((c) => c.path.endsWith("/install"))?.body).toEqual({ fetch_id: "fedcba9876543210", accept: true, digest: "d".repeat(64), scripts: "do-not-run", scripts_accepted: ["postinstall"] });
    expect(usePluginsStore.getState().plugins.some((p) => p.name === "notes-tool")).toBe(true);
  });

  it("drops the answer of a download the person cancelled", async () => {
    serveFetch();
    const pending = usePluginsStore.getState().fetchPackage({ kind: "npm", spec: "notes-tool", version: "1.2.0" });
    usePluginsStore.getState().resetAdd();
    await pending;
    expect(usePluginsStore.getState().add.step).toBe("form");
  });

  it("keeps the form with the reason when fetch fails and returns to the form on cancel", async () => {
    routes.set("POST /cordis/plugins/fetch", { status: 422, body: { detail: { code: "not_found", message: "No such package" } } });
    await usePluginsStore.getState().fetchPackage({ kind: "npm", spec: "nope", version: "1.0.0" });
    expect(usePluginsStore.getState().add).toMatchObject({ step: "form", error: { code: "not_found", message: "No such package" } });
    usePluginsStore.getState().resetAdd();
    expect(usePluginsStore.getState().add.step).toBe("form");
    expect(usePluginsStore.getState().add.error).toBeNull();
  });
});
