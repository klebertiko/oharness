import { afterEach, beforeEach, vi } from "vitest";
import type { PluginView } from "./types";

export type Reply = { status?: number; body?: unknown; raw?: BodyInit; headers?: Record<string, string> };
export const calls: { method: string; path: string; body?: unknown; headers: Record<string, string> }[] = [];
export const routes = new Map<string, Reply>();

export const plugin = (over: Partial<PluginView> = {}): PluginView => ({
  id: "0123456789abcdef", name: "notes-tool", version: "1.2.0", source: { kind: "npm", spec: "notes-tool", version: "1.2.0" }, enabled: true,
  scripts: [], runtime: "isolated", capabilities: ["files"], state: "active", message: null, ...over,
});

export const preview = (over: Record<string, unknown> = {}) => ({
  fetchId: "fedcba9876543210", source: { kind: "npm", spec: "notes-tool", version: "1.2.0" },
  preview: {
    name: "notes-tool", version: "1.2.0", runtime: "isolated", runtimeDefaulted: false, capabilities: ["files", "network"], capabilitiesDeclared: true,
    isolation: { enforced: ["processes", "credentials"], notEnforced: ["network"] }, scripts: ["postinstall"], bundlePatchIgnored: false, digest: "d".repeat(64),
    warning: { en: "Host warning in English.", "pt-BR": "Aviso do host em portugues." }, unmetDependencies: [], warnings: [], ...over,
  },
});

/** Stubs `fetch` with a route table keyed `METHOD /path`; unknown routes answer 404. Call inside a describe body. */
export function useSidecarStub() {
  beforeEach(() => {
    calls.length = 0;
    routes.clear();
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const u = new URL(url);
      const key = `${init.method ?? "GET"} ${u.pathname}`;
      calls.push({ method: init.method ?? "GET", path: u.pathname + u.search, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: (init.headers ?? {}) as Record<string, string> });
      const reply = routes.get(key);
      if (!reply) return new Response("{}", { status: 404 });
      if (reply.raw !== undefined) return new Response(reply.raw, { status: reply.status ?? 200, headers: reply.headers });
      return new Response(reply.status === 204 ? null : JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as { __OH_HUMAN__?: string }).__OH_HUMAN__;
  });
}

export const niloRequest = (over: Record<string, unknown> = {}) => ({
  id: "1111222233334444", devName: "hello-tool", name: "hello-tool", version: "0.1.0", createdAt: 1, status: "pending", changed: false, replaces: null,
  preview: { ...preview().preview, name: "hello-tool", version: "0.1.0", capabilities: [], scripts: [], isolation: { enforced: ["files", "processes", "credentials"], notEnforced: ["network"] } },
  ...over,
});

export const pluginIndex = {
  title: "Community",
  skipped: 1,
  plugins: [
    { name: "notes-tool", title: "Notes", description: "<b>Keeps</b> notes.", author: "Ana", repository: "https://github.com/ana/notes", versions: [{ version: "1.2.0", source: { type: "npm" } }] },
    { name: "git-thing", title: "Git thing", description: "From GitHub.", author: "Bo", repository: null, versions: [{ version: "0.1.0", source: { type: "git", url: "https://github.com/bo/thing", commit: "c".repeat(40), path: "pkg", repo: "bo/thing" } }] },
  ],
};
