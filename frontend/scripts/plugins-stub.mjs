/**
 * The stubbed sidecar (`/cordis/*`, ADR 0071) and the fixtures the Cordis Plugins end-to-end scripts share. Not a test itself: the file name
 * does not start with e2e-, so scripts/run-e2e.mjs does not run it.
 */
export const API = "http://127.0.0.1:18099";
export const ID = "0123456789abcdef";
export const FETCH_ID = "fedcba9876543210";
export const DIGEST = "d".repeat(64);

export const view = (over = {}) => ({
  id: ID, name: "notes-tool", version: "1.2.0", source: { kind: "npm", spec: "notes-tool", version: "1.2.0" }, enabled: true, scripts: [], runtime: "isolated",
  capabilities: ["files"], state: "active", message: null, ...over,
});

export const fetched = {
  fetchId: FETCH_ID, source: { kind: "npm", spec: "echo-tool", version: "0.3.1" },
  preview: {
    name: "echo-tool", version: "0.3.1", runtime: "isolated", runtimeDefaulted: false, capabilities: ["files", "network"], capabilitiesDeclared: true,
    isolation: { enforced: ["processes", "credentials"], notEnforced: ["network"] }, scripts: ["postinstall", "prepare"], bundlePatchIgnored: false, digest: DIGEST,
    warning: { en: "A third-party Cordis plugin runs in its own process. Install a plugin only after you have reviewed it.", "pt-BR": "Um Cordis plugin de terceiros roda num processo proprio. Instale so depois de revisar." },
    unmetDependencies: [], warnings: [],
  },
};

export const request = {
  id: "1111222233334444", devName: "hello-tool", name: "hello-tool", version: "0.1.0", createdAt: 1, status: "pending", changed: false, replaces: null,
  preview: { ...fetched.preview, name: "hello-tool", version: "0.1.0", capabilities: [], scripts: [], isolation: { enforced: ["files", "processes", "credentials"], notEnforced: ["network"] } },
};

export const index = {
  title: "Community", skipped: 1,
  plugins: [
    { name: "notes-tool", title: "Notes", description: "<img src=x onerror=alert(1)> Keeps notes.", author: "Ana", repository: "https://github.com/ana/notes", versions: [{ version: "1.2.0", source: { type: "npm" } }] },
    { name: "git-thing", title: "Git thing", description: "From GitHub at a commit.", author: "Bo", repository: null, versions: [{ version: "0.1.0", source: { type: "git", url: "https://github.com/bo/thing", commit: "c".repeat(40), path: "pkg", repo: "bo/thing" } }] },
    { name: "tar-thing", title: "Tar thing", description: "From a tarball with its hash.", author: "Cy", repository: null, versions: [{ version: "2.0.0", source: { type: "tarball", url: "https://example.com/tar-thing-2.0.0.tgz", integrity: `sha512-${"A".repeat(86)}==` } }] },
  ],
};

const STEPS = ["downloading", "verifying", "extracting", "preview-ready"];
const at = (step, i) => ({ step, at: i + 1 });

/** `state.hold` keeps the download running (so the live log can be seen); release it and the next read finds the preview ready. */
export function sidecar() {
  const calls = [];
  const state = { hold: false, installed: false };
  let requests = [request];
  const creator = {};
  let plugins = [view(), view({ id: "aaaaaaaaaaaaaaaa", name: "broken-one", version: "0.1.0", state: "failed", message: "Cannot find module 'left-pad'", capabilities: [] })];
  const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
  const handle = (method, path, body, query = new URLSearchParams()) => {
    calls.push({ method, path, body, query: query.toString() });
    if (method === "GET" && path === "/cordis/status") return json({ state: "running", reason: null, restarts: 0, node: "22.20.0", hostLog: [], plugins: plugins.length });
    if (method === "GET" && path === "/cordis/plugins") return json({ plugins });
    if (method === "GET" && path === "/cordis/requests") return json({ requests });
    if (method === "GET" && path === "/cordis/creator") {
      const id = query.get("thread_id");
      return json({ threadId: id, enabled: creator[id] === true });
    }
    if (method === "POST" && path === "/cordis/creator") {
      creator[body.thread_id] = body.enabled;
      return json({ threadId: body.thread_id, enabled: body.enabled });
    }
    if (method === "POST" && path === `/cordis/requests/${request.id}/approve`) {
      requests = [];
      plugins = [...plugins, view({ id: "cccccccccccccccc", name: "hello-tool", version: "0.1.0", capabilities: [], madeByNilo: true })];
      return json({ request: { ...request, status: "approved" }, plugin: plugins.at(-1) });
    }
    if (method === "POST" && path === "/cordis/index/fetch") return json(index);
    if (method === "GET" && path.endsWith("/logs")) return json({ lines: ["[plugin notes-tool] started", "[plugin notes-tool] error: left-pad missing"] });
    if (method === "POST" && path === "/cordis/plugins/fetch") {
      state.installed = false;
      return json({ fetchId: FETCH_ID, state: "running", events: [] });
    }
    if (method === "GET" && path === `/cordis/plugins/fetch/${FETCH_ID}`) {
      if (state.hold) return json({ fetchId: FETCH_ID, state: "running", events: STEPS.slice(0, 2).map(at) });
      if (state.installed) return json({ fetchId: FETCH_ID, state: "installed", events: [...STEPS, "installing", "done"].map(at), result: { fetchId: FETCH_ID, source: fetched.source, preview: fetched.preview } });
      return json({ fetchId: FETCH_ID, state: "ready", events: STEPS.map(at), result: { fetchId: FETCH_ID, source: fetched.source, preview: fetched.preview } });
    }
    if (method === "DELETE" && path === `/cordis/plugins/fetch/${FETCH_ID}`) return json({ fetchId: FETCH_ID, state: "cancelled", events: [at("cancelled", 0)] });
    if (method === "POST" && path === "/cordis/plugins/install") {
      state.installed = true;
      plugins = [...plugins, view({ id: "bbbbbbbbbbbbbbbb", name: "echo-tool", version: "0.3.1", enabled: false, state: "disabled", scripts: ["postinstall", "prepare"], capabilities: ["files", "network"] })];
      return json(plugins.at(-1));
    }
    if (method === "POST" && path.endsWith("/enable")) {
      plugins = plugins.map((p) => (p.id === path.split("/")[3] ? { ...p, enabled: true, state: "active" } : p));
      return json(plugins.find((p) => p.id === path.split("/")[3]));
    }
    if (method === "GET" && path === `/cordis/plugins/${ID}/export/index`) return { status: 200, contentType: "application/json", headers: { "content-disposition": 'attachment; filename="index.json"' }, body: '{"format":1}' };
    if (method === "GET" && path === `/cordis/plugins/${ID}/export`) return { status: 200, contentType: "application/gzip", headers: { "content-disposition": 'attachment; filename="notes-tool-1.2.0.tgz"' }, body: "tgz" };
    return json({}, 404);
  };
  return { calls, handle, state };
}

export const launchOptions = (require) => {
  void require;
  return process.env.OHM_BROWSER_EXECUTABLE
    ? { executablePath: process.env.OHM_BROWSER_EXECUTABLE, headless: true }
    : { channel: process.env.OHM_BROWSER_CHANNEL || "msedge", headless: true };
};

/** Routes the sidecar's origin to the stub and lets the static export through; anything else is refused. */
export async function routeSidecar(context, base, stub) {
  await context.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === new URL(base).origin) return route.continue();
    if (url.origin !== API) return route.fulfill({ status: 404, body: "{}" });
    return route.fulfill(stub.handle(request.method(), url.pathname, request.postData() ? JSON.parse(request.postData()) : undefined, url.searchParams));
  });
}
