import { beforeEach, describe, expect, it } from "vitest";
import { calls, FETCH_ID, plugin, preview, readyJob, routes, runningJob, serveFetch, useSidecarStub } from "@/components/plugins/testKit";
import { usePluginsStore } from "./pluginsStore";

const npm = { kind: "npm" as const, spec: "notes-tool", version: "1.2.0" };
const getsOf = () => calls.filter((c) => c.method === "GET" && c.path === `/cordis/plugins/fetch/${FETCH_ID}`);
const until = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(done()).toBe(true);
};

describe("pluginsStore: live fetch with a log and a real Cancel", () => {
  useSidecarStub();
  beforeEach(() => usePluginsStore.getState().reset());

  it("starts the fetch live, polls the job until it leaves running and ends in the preview with its steps", async () => {
    serveFetch();
    await usePluginsStore.getState().fetchPackage(npm);
    expect(calls[0].body).toEqual({ ...npm, live: true });
    const { add } = usePluginsStore.getState();
    expect(add.step).toBe("preview");
    expect(add.fetchId).toBe(FETCH_ID);
    expect(add.events.map((e) => e.step)).toEqual(["downloading", "verifying", "extracting", "preview-ready"]);
    expect(add.fetched?.preview.name).toBe("notes-tool");
  });

  it("keeps polling while the job runs and shows the steps it has so far", async () => {
    routes.set("POST /cordis/plugins/fetch", { body: runningJob() });
    routes.set(`GET /cordis/plugins/fetch/${FETCH_ID}`, { body: runningJob({ events: [{ step: "downloading", at: 1 }] }) });
    const pending = usePluginsStore.getState().fetchPackage(npm);
    await until(() => getsOf().length >= 3);
    expect(usePluginsStore.getState().add).toMatchObject({ step: "fetching", fetchId: FETCH_ID, events: [{ step: "downloading", at: 1 }] });
    routes.set(`GET /cordis/plugins/fetch/${FETCH_ID}`, { body: readyJob() });
    await pending;
    expect(usePluginsStore.getState().add.step).toBe("preview");
  });

  it("returns to the form with the reason when the job failed", async () => {
    routes.set("POST /cordis/plugins/fetch", { body: runningJob() });
    routes.set(`GET /cordis/plugins/fetch/${FETCH_ID}`, { body: runningJob({ state: "failed", error: { code: "integrity_mismatch", message: "The hash does not match." } }) });
    await usePluginsStore.getState().fetchPackage(npm);
    expect(usePluginsStore.getState().add).toMatchObject({ step: "form", error: { code: "integrity_mismatch", message: "The hash does not match." } });
  });

  it("Cancel aborts the polling and asks the sidecar to stop and delete the download", async () => {
    serveFetch();
    routes.set(`GET /cordis/plugins/fetch/${FETCH_ID}`, { body: runningJob() });
    const pending = usePluginsStore.getState().fetchPackage(npm);
    await until(() => getsOf().length >= 2);
    const signal = getsOf()[0].signal;
    usePluginsStore.getState().resetAdd();
    await pending;
    expect(signal?.aborted).toBe(true);
    await until(() => calls.some((c) => c.method === "DELETE" && c.path === `/cordis/plugins/fetch/${FETCH_ID}`));
    const after = getsOf().length;
    await new Promise((r) => setTimeout(r, 40));
    expect(getsOf().length).toBe(after);
    expect(usePluginsStore.getState().add.step).toBe("form");
  });

  it("an answer that arrives after Cancel is dropped and its download deleted", async () => {
    serveFetch();
    const pending = usePluginsStore.getState().fetchPackage(npm);
    usePluginsStore.getState().resetAdd();
    await pending;
    expect(usePluginsStore.getState().add.step).toBe("form");
    await until(() => calls.some((c) => c.method === "DELETE"));
  });

  it("after install a last read brings the installing and done steps; the log stays", async () => {
    serveFetch({ scripts: [] });
    await usePluginsStore.getState().fetchPackage(npm);
    routes.set("POST /cordis/plugins/install", { body: plugin({ state: "active" }) });
    routes.set(`GET /cordis/plugins/fetch/${FETCH_ID}`, { body: { ...readyJob({ scripts: [] }), state: "installed", events: [...readyJob().events, { step: "installing", at: 7 }, { step: "done", at: 8 }] } });
    await usePluginsStore.getState().install(true);
    const { add } = usePluginsStore.getState();
    expect(add.step).toBe("done");
    expect(add.events.map((e) => e.step).slice(-2)).toEqual(["installing", "done"]);
  });
});

describe("pluginsStore: a decision for each lifecycle script", () => {
  useSidecarStub();
  beforeEach(() => usePluginsStore.getState().reset());

  it("keeps decisions by fetch and digest and never reuses them for another fetch", () => {
    const { decideScript } = usePluginsStore.getState();
    decideScript(FETCH_ID, "a".repeat(64), "postinstall", "accept");
    expect(usePluginsStore.getState().scripts).toEqual({ key: `${FETCH_ID}:${"a".repeat(64)}`, decisions: { postinstall: "accept" } });
    decideScript("1111222233334444", "a".repeat(64), "install", "accept");
    expect(usePluginsStore.getState().scripts.decisions).toEqual({ install: "accept" });
    decideScript("1111222233334444", "b".repeat(64), "install", "accept");
    expect(usePluginsStore.getState().scripts.decisions).toEqual({ install: "accept" });
    expect(usePluginsStore.getState().scripts.key).toBe(`1111222233334444:${"b".repeat(64)}`);
  });

  it("sends nothing while a script has no decision, then sends the accepted list", async () => {
    serveFetch({ scripts: ["postinstall", "prepare"] });
    routes.set("POST /cordis/plugins/install", { body: plugin() });
    await usePluginsStore.getState().fetchPackage(npm);
    await usePluginsStore.getState().install(true);
    expect(calls.some((c) => c.path.endsWith("/install"))).toBe(false);
    const digest = "d".repeat(64);
    usePluginsStore.getState().decideScript(FETCH_ID, digest, "postinstall", "accept");
    await usePluginsStore.getState().install(true);
    expect(calls.some((c) => c.path.endsWith("/install"))).toBe(false);
    usePluginsStore.getState().decideScript(FETCH_ID, digest, "prepare", "decline");
    await usePluginsStore.getState().install(true);
    expect(calls.some((c) => c.path.endsWith("/install"))).toBe(false);
    usePluginsStore.getState().decideScript(FETCH_ID, digest, "prepare", "accept");
    await usePluginsStore.getState().install(true);
    expect(calls.find((c) => c.path.endsWith("/install"))?.body).toEqual({ fetch_id: FETCH_ID, accept: true, digest, scripts: "do-not-run", scripts_accepted: ["postinstall", "prepare"] });
  });

  it("Do not install deletes the download, returns to the form and says nothing was installed", async () => {
    serveFetch();
    await usePluginsStore.getState().fetchPackage(npm);
    await usePluginsStore.getState().declineAdd();
    expect(calls.some((c) => c.method === "DELETE" && c.path === `/cordis/plugins/fetch/${FETCH_ID}`)).toBe(true);
    expect(calls.some((c) => c.path.endsWith("/install"))).toBe(false);
    expect(usePluginsStore.getState().add).toMatchObject({ step: "form", notice: "declined", fetched: null });
    expect(usePluginsStore.getState().scripts.decisions).toEqual({});
  });

  it("a request from Nilo with scripts is not approved before every script has a decision", async () => {
    window.__OH_HUMAN__ = "h";
    const request = { id: "1111222233334444", devName: "x", name: "x", version: "1.0.0", createdAt: 1, status: "pending", changed: false, replaces: null, preview: { ...preview().preview, scripts: ["postinstall"] } };
    routes.set("GET /cordis/requests", { body: { requests: [request] } });
    routes.set("POST /cordis/requests/1111222233334444/approve", { body: { request, plugin: plugin() } });
    await usePluginsStore.getState().loadNilo();
    await usePluginsStore.getState().approve("1111222233334444");
    expect(calls.some((c) => c.path.endsWith("/approve"))).toBe(false);
    usePluginsStore.getState().decideScript(request.id, request.preview.digest, "postinstall", "accept");
    await usePluginsStore.getState().approve("1111222233334444");
    expect(calls.find((c) => c.path.endsWith("/approve"))?.body).toBeUndefined();
  });
});
