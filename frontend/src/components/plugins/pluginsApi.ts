/**
 * The plugin screen's calls to the sidecar (`/cordis/*`, ADR 0071). Anything that fetches, installs, switches or removes a plugin needs the
 * person's credential, which the desktop shell hands to the webview as `window.__OH_HUMAN__`; without it the sidecar answers 403 `human_only`.
 */
import { apiUrl } from "@/lib/apiBase";
import type { FetchJob, FetchRequest, HostStatus, InstallRequest, NiloRequest, PluginIndex, PluginView } from "./types";

declare global {
  interface Window {
    /** The person's credential, injected by the desktop shell (never persisted by the UI). Also declared by the Forja client. */
    __OH_HUMAN__?: string;
  }
}

export class PluginsError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public state?: string,
  ) {
    super(message);
  }
}

export const hasHumanCredential = (): boolean => typeof window !== "undefined" && !!window.__OH_HUMAN__;

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const human = typeof window !== "undefined" ? window.__OH_HUMAN__ : undefined;
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { ...init, headers: { "Content-Type": "application/json", ...(human ? { "x-oharness-human": human } : {}), ...init.headers } });
  } catch (error) {
    throw new PluginsError(0, "unreachable", error instanceof Error ? error.message : String(error));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = (body as { detail?: { code?: string; message?: string; state?: string } }).detail ?? {};
    throw new PluginsError(res.status, detail.code ?? `http_${res.status}`, detail.message ?? res.statusText, detail.state);
  }
  return res;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await send(path, init);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

async function download(path: string, fallback: string): Promise<{ filename: string; blob: Blob }> {
  const res = await send(path);
  const match = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "");
  return { filename: match?.[1] ?? fallback, blob: await res.blob() };
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const enc = encodeURIComponent;

export const pluginsApi = {
  status: () => call<HostStatus>("/cordis/status"),
  list: () => call<{ plugins: PluginView[] }>("/cordis/plugins"),
  /** Starts the download and answers at once with the job; `fetchStatus` reports each step and `cancelFetch` stops it and deletes what was staged. */
  startFetch: (body: FetchRequest) => call<FetchJob>("/cordis/plugins/fetch", post({ ...body, live: true })),
  fetchStatus: (id: string, signal?: AbortSignal) => call<FetchJob>(`/cordis/plugins/fetch/${enc(id)}`, { signal }),
  cancelFetch: (id: string) => call<FetchJob>(`/cordis/plugins/fetch/${enc(id)}`, { method: "DELETE" }),
  install: (body: InstallRequest) => call<PluginView>("/cordis/plugins/install", post(body)),
  enable: (id: string) => call<PluginView>(`/cordis/plugins/${enc(id)}/enable`, { method: "POST" }),
  disable: (id: string) => call<PluginView>(`/cordis/plugins/${enc(id)}/disable`, { method: "POST" }),
  remove: (id: string) => call<void>(`/cordis/plugins/${enc(id)}`, { method: "DELETE" }),
  logs: (id: string, tail = 200) => call<{ lines: string[] }>(`/cordis/plugins/${enc(id)}/logs?tail=${tail}`),
  /** Creator mode belongs to one chat thread: the cordis_plugins tool is offered only in the threads where the person turned it on. */
  creator: (threadId: string) => call<{ threadId: string; enabled: boolean }>(`/cordis/creator?thread_id=${enc(threadId)}`),
  setCreator: (threadId: string, enabled: boolean) => call<{ threadId: string; enabled: boolean }>("/cordis/creator", post({ thread_id: threadId, enabled })),
  requests: () => call<{ requests: NiloRequest[] }>("/cordis/requests"),
  approve: (id: string) => call<{ request: NiloRequest; plugin: PluginView }>(`/cordis/requests/${enc(id)}/approve`, { method: "POST" }),
  reject: (id: string) => call<{ request: NiloRequest }>(`/cordis/requests/${enc(id)}/reject`, { method: "POST" }),
  /** The sidecar fetches the index (https only, size ceiling); the screen never talks to the third party itself. */
  fetchIndex: (url: string) => call<PluginIndex>("/cordis/index/fetch", post({ url })),
  /** The package as a .tgz; the file name comes from the sidecar's `content-disposition`. */
  exportPackage: (id: string) => download(`/cordis/plugins/${enc(id)}/export`, "plugin.tgz"),
  /** The index.json (format 1) for the package, built by reading package.json and the files, without running code. */
  exportIndex: (id: string) => download(`/cordis/plugins/${enc(id)}/export/index`, "index.json"),
};
