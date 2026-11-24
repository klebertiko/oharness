import { describe, expect, it } from "vitest";
import { pluginsApi, PluginsError } from "./pluginsApi";
import { calls, plugin, routes, runningJob, useSidecarStub } from "./testKit";

describe("pluginsApi", () => {
  useSidecarStub();

  it("reads status and the list without the human credential", async () => {
    routes.set("GET /cordis/status", { body: { state: "running", reason: null, restarts: 0, node: "22.20.0", hostLog: [], plugins: 1 } });
    routes.set("GET /cordis/plugins", { body: { plugins: [plugin()] } });
    expect((await pluginsApi.status()).state).toBe("running");
    expect((await pluginsApi.list()).plugins[0].name).toBe("notes-tool");
    expect(calls.every((c) => !("x-oharness-human" in c.headers))).toBe(true);
  });

  it("sends the human credential on changes and the exact body on fetch and install", async () => {
    window.__OH_HUMAN__ = "h-token";
    routes.set("POST /cordis/plugins/fetch", { body: runningJob() });
    routes.set("POST /cordis/plugins/install", { body: plugin() });
    await pluginsApi.startFetch({ kind: "npm", spec: "notes-tool", version: "1.2.0" });
    await pluginsApi.install({ fetch_id: "fedcba9876543210", accept: true, digest: "d".repeat(64), scripts: "do-not-run", scripts_accepted: ["postinstall"] });
    expect(calls[0].headers["x-oharness-human"]).toBe("h-token");
    expect(calls[0].body).toEqual({ kind: "npm", spec: "notes-tool", version: "1.2.0", live: true });
    expect(calls[1].body).toEqual({ fetch_id: "fedcba9876543210", accept: true, digest: "d".repeat(64), scripts: "do-not-run", scripts_accepted: ["postinstall"] });
  });

  it("reads, cancels and exports with the human credential: job, DELETE, index.json, creator by thread", async () => {
    window.__OH_HUMAN__ = "h-token";
    routes.set("GET /cordis/plugins/fetch/fedcba9876543210", { body: runningJob() });
    routes.set("DELETE /cordis/plugins/fetch/fedcba9876543210", { body: runningJob({ state: "cancelled" }) });
    routes.set("GET /cordis/plugins/0123456789abcdef/export/index", { raw: "{}", headers: { "content-disposition": 'attachment; filename="index.json"' } });
    routes.set("GET /cordis/creator", { body: { threadId: "t-1", enabled: true } });
    routes.set("POST /cordis/creator", { body: { threadId: "t-1", enabled: false } });
    await pluginsApi.fetchStatus("fedcba9876543210");
    expect((await pluginsApi.cancelFetch("fedcba9876543210")).state).toBe("cancelled");
    expect((await pluginsApi.exportIndex("0123456789abcdef")).filename).toBe("index.json");
    expect((await pluginsApi.creator("t-1")).enabled).toBe(true);
    await pluginsApi.setCreator("t-1", false);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /cordis/plugins/fetch/fedcba9876543210",
      "DELETE /cordis/plugins/fetch/fedcba9876543210",
      "GET /cordis/plugins/0123456789abcdef/export/index",
      "GET /cordis/creator?thread_id=t-1",
      "POST /cordis/creator",
    ]);
    expect(calls.every((c) => c.headers["x-oharness-human"] === "h-token")).toBe(true);
    expect(calls[4].body).toEqual({ thread_id: "t-1", enabled: false });
  });

  it("turns 403 human_only and 503 cordis_unavailable into typed errors", async () => {
    routes.set("POST /cordis/plugins/0123456789abcdef/enable", { status: 403, body: { detail: { code: "human_only", message: "no" } } });
    routes.set("GET /cordis/plugins", { status: 503, body: { detail: { code: "cordis_unavailable", state: "unavailable", message: "Node.js was not found" } } });
    await expect(pluginsApi.enable("0123456789abcdef")).rejects.toMatchObject({ status: 403, code: "human_only" });
    const error = await pluginsApi.list().catch((e) => e);
    expect(error).toBeInstanceOf(PluginsError);
    expect(error).toMatchObject({ code: "cordis_unavailable", state: "unavailable", message: "Node.js was not found" });
  });

  it("sends the human credential on logs and export too, which need it", async () => {
    window.__OH_HUMAN__ = "h-token";
    routes.set("GET /cordis/plugins/0123456789abcdef/logs", { body: { lines: [] } });
    routes.set("GET /cordis/plugins/0123456789abcdef/export", { raw: "x" });
    await pluginsApi.logs("0123456789abcdef");
    await pluginsApi.exportPackage("0123456789abcdef");
    expect(calls.map((c) => c.headers["x-oharness-human"])).toEqual(["h-token", "h-token"]);
  });

  it("removes with DELETE and reads logs and the package export", async () => {
    routes.set("DELETE /cordis/plugins/0123456789abcdef", { status: 204 });
    routes.set("GET /cordis/plugins/0123456789abcdef/logs", { body: { lines: ["a", "b"] } });
    routes.set("GET /cordis/plugins/0123456789abcdef/export", { raw: "tgz", headers: { "content-disposition": 'attachment; filename="notes-tool-1.2.0.tgz"' } });
    await pluginsApi.remove("0123456789abcdef");
    expect((await pluginsApi.logs("0123456789abcdef")).lines).toEqual(["a", "b"]);
    const file = await pluginsApi.exportPackage("0123456789abcdef");
    expect(file.filename).toBe("notes-tool-1.2.0.tgz");
    expect(await file.blob.text()).toBe("tgz");
  });
});
