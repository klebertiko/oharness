import { describe, expect, it } from "vitest";
import { pluginsApi, PluginsError } from "./pluginsApi";
import { calls, plugin, preview, routes, useSidecarStub } from "./testKit";

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
    routes.set("POST /cordis/plugins/fetch", { body: preview() });
    routes.set("POST /cordis/plugins/install", { body: plugin() });
    await pluginsApi.fetchPackage({ kind: "npm", spec: "notes-tool", version: "1.2.0" });
    await pluginsApi.install({ fetch_id: "fedcba9876543210", accept: true, digest: "d".repeat(64), scripts: "do-not-run" });
    expect(calls[0].headers["x-oharness-human"]).toBe("h-token");
    expect(calls[0].body).toEqual({ kind: "npm", spec: "notes-tool", version: "1.2.0" });
    expect(calls[1].body).toEqual({ fetch_id: "fedcba9876543210", accept: true, digest: "d".repeat(64), scripts: "do-not-run" });
  });

  it("turns 403 human_only and 503 cordis_unavailable into typed errors", async () => {
    routes.set("POST /cordis/plugins/0123456789abcdef/enable", { status: 403, body: { detail: { code: "human_only", message: "no" } } });
    routes.set("GET /cordis/plugins", { status: 503, body: { detail: { code: "cordis_unavailable", state: "unavailable", message: "Node.js was not found" } } });
    await expect(pluginsApi.enable("0123456789abcdef")).rejects.toMatchObject({ status: 403, code: "human_only" });
    const error = await pluginsApi.list().catch((e) => e);
    expect(error).toBeInstanceOf(PluginsError);
    expect(error).toMatchObject({ code: "cordis_unavailable", state: "unavailable", message: "Node.js was not found" });
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
