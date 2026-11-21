/**
 * The plugin screen's calls to the sidecar (`/cordis/*`, ADR 0071). Anything that fetches, installs, switches or removes a plugin needs the
 * person's credential, which the desktop shell hands to the webview as `window.__OH_HUMAN__`; without it the sidecar answers 403 `human_only`.
 */
import { apiUrl } from "@/lib/apiBase";
import type { FetchRequest, FetchResult, HostStatus, InstallRequest, PluginView } from "./types";

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

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const enc = encodeURIComponent;

export const pluginsApi = {
  status: () => call<HostStatus>("/cordis/status"),
  list: () => call<{ plugins: PluginView[] }>("/cordis/plugins"),
  fetchPackage: (body: FetchRequest) => call<FetchResult>("/cordis/plugins/fetch", post(body)),
  install: (body: InstallRequest) => call<PluginView>("/cordis/plugins/install", post(body)),
  enable: (id: string) => call<PluginView>(`/cordis/plugins/${enc(id)}/enable`, { method: "POST" }),
  disable: (id: string) => call<PluginView>(`/cordis/plugins/${enc(id)}/disable`, { method: "POST" }),
  remove: (id: string) => call<void>(`/cordis/plugins/${enc(id)}`, { method: "DELETE" }),
  logs: (id: string, tail = 200) => call<{ lines: string[] }>(`/cordis/plugins/${enc(id)}/logs?tail=${tail}`),
  /** The package as a .tgz; the file name comes from the sidecar's `content-disposition`. */
  async exportPackage(id: string): Promise<{ filename: string; blob: Blob }> {
    const res = await send(`/cordis/plugins/${enc(id)}/export`);
    const match = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "");
    return { filename: match?.[1] ?? "plugin.tgz", blob: await res.blob() };
  },
};
