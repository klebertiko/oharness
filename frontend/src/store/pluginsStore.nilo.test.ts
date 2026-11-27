import { beforeEach, describe, expect, it } from "vitest";
import { calls, niloRequest, plugin, pluginIndex, routes, useSidecarStub } from "@/components/plugins/testKit";
import { usePluginsStore } from "./pluginsStore";

describe("pluginsStore: Nilo requests, creator mode and Descobrir", () => {
  useSidecarStub();
  beforeEach(() => usePluginsStore.getState().reset());

  it("loads the pending requests and the creator switch, and ignores a sidecar without them", async () => {
    await usePluginsStore.getState().loadNilo();
    expect(usePluginsStore.getState().requests).toEqual([]);
    routes.set("GET /cordis/requests", { body: { requests: [niloRequest(), niloRequest({ id: "9999888877776666", status: "rejected" })] } });
    await usePluginsStore.getState().loadNilo();
    expect(usePluginsStore.getState().requests.map((r) => r.status)).toEqual(["pending"]);
  });

  it("creator mode is per thread: loads and sets it with the thread id, never globally", async () => {
    await usePluginsStore.getState().loadCreator("t-a");
    expect(usePluginsStore.getState().creatorByThread).toEqual({});
    routes.set("GET /cordis/creator", { body: { threadId: "t-a", enabled: true } });
    await usePluginsStore.getState().loadCreator("t-a");
    expect(calls.at(-1)?.path).toBe("/cordis/creator?thread_id=t-a");
    expect(usePluginsStore.getState().creatorByThread).toEqual({ "t-a": true });
    routes.set("POST /cordis/creator", { body: { threadId: "t-b", enabled: true } });
    await usePluginsStore.getState().setCreator("t-b", true);
    expect(calls.at(-1)?.body).toEqual({ thread_id: "t-b", enabled: true });
    routes.set("POST /cordis/creator", { body: { threadId: "t-a", enabled: false } });
    await usePluginsStore.getState().setCreator("t-a", false);
    expect(usePluginsStore.getState().creatorByThread).toEqual({ "t-a": false, "t-b": true });
    routes.set("POST /cordis/creator", { status: 403, body: { detail: { code: "human_only", message: "no" } } });
    await usePluginsStore.getState().setCreator("t-c", true);
    expect(usePluginsStore.getState().requestError?.code).toBe("human_only");
    expect(usePluginsStore.getState().creatorByThread["t-c"]).toBeUndefined();
  });

  it("approves with the human credential and puts the plugin in the list", async () => {
    window.__OH_HUMAN__ = "h";
    routes.set("GET /cordis/requests", { body: { requests: [niloRequest()] } });
    await usePluginsStore.getState().loadNilo();
    routes.set("POST /cordis/requests/1111222233334444/approve", { body: { request: niloRequest({ status: "approved" }), plugin: plugin({ name: "hello-tool" }) } });
    routes.set("GET /cordis/requests", { body: { requests: [] } });
    await usePluginsStore.getState().approve("1111222233334444");
    const call = calls.find((c) => c.path.endsWith("/approve"));
    expect(call?.headers["x-oharness-human"]).toBe("h");
    expect(usePluginsStore.getState().plugins.map((p) => p.name)).toEqual(["hello-tool"]);
    expect(usePluginsStore.getState().requests).toEqual([]);
  });

  it("shows why an approval failed and keeps the request", async () => {
    routes.set("GET /cordis/requests", { body: { requests: [niloRequest()] } });
    await usePluginsStore.getState().loadNilo();
    routes.set("POST /cordis/requests/1111222233334444/approve", { status: 409, body: { detail: { code: "request_stale", message: "The files changed." } } });
    await usePluginsStore.getState().approve("1111222233334444");
    expect(usePluginsStore.getState().requestError).toEqual({ code: "request_stale", message: "The files changed." });
  });

  it("rejects a request", async () => {
    routes.set("GET /cordis/requests", { body: { requests: [niloRequest()] } });
    await usePluginsStore.getState().loadNilo();
    routes.set("POST /cordis/requests/1111222233334444/reject", { body: { request: niloRequest({ status: "rejected" }) } });
    routes.set("GET /cordis/requests", { body: { requests: [] } });
    await usePluginsStore.getState().reject("1111222233334444");
    expect(usePluginsStore.getState().requests).toEqual([]);
  });

  it("loads an index through the sidecar and refuses a non-https address before asking", async () => {
    await usePluginsStore.getState().loadIndex("http://example.com/i.json");
    expect(usePluginsStore.getState().discover.error?.code).toBe("invalid_url");
    expect(calls).toHaveLength(0);
    routes.set("POST /cordis/index/fetch", { body: pluginIndex });
    await usePluginsStore.getState().loadIndex(" https://example.com/i.json ");
    expect(calls[0].body).toEqual({ url: "https://example.com/i.json" });
    expect(usePluginsStore.getState().discover.index?.plugins).toHaveLength(3);
  });
});
