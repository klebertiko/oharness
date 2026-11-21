/**
 * Sidecar client for `/cordis/*`. Mutations send the person's credential
 * (`window.__OH_HUMAN__`, ADR 0055). The install log is polled while the
 * install request is still open, so lines show up before it returns.
 */
import { apiUrl } from "@/lib/apiBase";
import type { CreatorAction, DecideResult, InspectedPackage, InstallBody, MarketIndex, PluginView, PluginsClient, ProposeInput, ShareResult, SourceRef } from "./pluginsTypes";

declare global {
  interface Window {
    __OH_HUMAN__?: string;
  }
}

export class PluginsError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface FetchResponse {
  fetchId: string;
  source: SourceRef;
  preview: {
    name: string;
    version: string;
    runtime?: string;
    capabilities?: string[];
    scripts?: string[];
    digest: string;
    unmetDependencies?: string[];
    isolation?: { enforced: string[]; notEnforced: string[] } | null;
  };
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const human = typeof window !== "undefined" ? window.__OH_HUMAN__ : undefined;
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { "Content-Type": "application/json", ...(human ? { "x-oharness-human": human } : {}), ...init.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (body as { detail?: { code?: string; message?: string } }).detail ?? {};
    throw new PluginsError(res.status, detail.code ?? `http_${res.status}`, detail.message ?? res.statusText);
  }
  return body as T;
}

const json = (value: unknown): RequestInit => ({ body: JSON.stringify(value) });

function toPackage(body: FetchResponse): InspectedPackage {
  const preview = body.preview;
  return {
    fetchId: body.fetchId,
    name: preview.name,
    version: preview.version,
    source: body.source,
    scripts: preview.scripts ?? [],
    runtime: preview.runtime ?? "isolated",
    capabilities: preview.capabilities ?? [],
    isolation: preview.isolation ?? null,
    digest: preview.digest,
    unmetDependencies: preview.unmetDependencies ?? [],
  };
}

async function readLog(fetchId: string): Promise<string[]> {
  const body = await call<{ lines: string[] }>(`/cordis/plugins/fetch/${fetchId}/log`);
  return body.lines ?? [];
}

export const pluginsClient: PluginsClient = {
  async fetch(source, signal) {
    const body = await call<FetchResponse>("/cordis/plugins/fetch", {
      method: "POST",
      signal,
      ...json({
        kind: source.kind,
        spec: source.spec,
        version: source.version ?? null,
        commit: source.commit ?? null,
        subdir: source.subdir ?? null,
      }),
    });
    return toPackage(body);
  },
  discard(fetchId) {
    return call<void>(`/cordis/plugins/fetch/${fetchId}`, { method: "DELETE" });
  },
  async install(body, onLog) {
    const timer = setInterval(() => {
      void readLog(body.fetchId).then(onLog).catch(() => undefined);
    }, 200);
    try {
      return await call<PluginView>("/cordis/plugins/install", {
        method: "POST",
        ...json({
          fetch_id: body.fetchId,
          accept: body.accept,
          digest: body.digest,
          enable: body.enable,
          ...(body.scripts ? { scripts: body.scripts } : {}),
        }),
      });
    } finally {
      clearInterval(timer);
      await readLog(body.fetchId).then(onLog).catch(() => undefined);
    }
  },
  async list() {
    const body = await call<{ plugins: PluginView[] }>("/cordis/plugins");
    return body.plugins ?? [];
  },
  status: () => call<{ state: string; reason?: string | null }>("/cordis/status"),
  enable: (id) => call<PluginView>(`/cordis/plugins/${id}/enable`, { method: "POST" }),
  disable: (id) => call<PluginView>(`/cordis/plugins/${id}/disable`, { method: "POST" }),
  remove: (id) => call<void>(`/cordis/plugins/${id}`, { method: "DELETE" }),
  async logs(id) {
    const body = await call<{ lines: string[] }>(`/cordis/plugins/${id}/logs`);
    return body.lines ?? [];
  },
  marketplace(url) {
    if (!url) return call<MarketIndex>("/cordis/marketplace");
    return call<MarketIndex>("/cordis/marketplace", { method: "POST", ...json({ url }) });
  },
  share: (id, target) => call<ShareResult>(`/cordis/plugins/${id}/share`, { method: "POST", ...json({ target }) }),
  async apis() {
    const body = await call<{ apis: { id: string; access: "read" }[] }>("/cordis/creator/apis");
    return body.apis ?? [];
  },
  writeStarter: (folder, name, description) =>
    call<{ path: string; files: string[] }>("/cordis/creator/write", { method: "POST", ...json({ folder, name, description }) }),
  async propose(input: ProposeInput) {
    const body = await call<CreatorAction>("/cordis/creator/actions", {
      method: "POST",
      ...json({ fetch_id: input.fetchId, digest: input.digest, summary: input.summary, scripts: input.scripts }),
    });
    return { ...body, name: input.name, version: input.version, enable: true, status: "pending" };
  },
  async decide(id, decision, enable) {
    const body = await call<{ applied?: boolean; plugin?: PluginView }>(`/cordis/creator/actions/${id}/decide`, {
      method: "POST",
      ...json({ decision, enable }),
    });
    const result: DecideResult = { applied: body.applied === true };
    if (body.plugin) result.plugin = body.plugin;
    return result;
  },
};

export function installBody(pkg: InspectedPackage, enable: boolean): InstallBody {
  return {
    fetchId: pkg.fetchId,
    accept: true,
    digest: pkg.digest,
    enable,
    ...(pkg.scripts.length ? { scripts: "do-not-run" as const } : {}),
  };
}
