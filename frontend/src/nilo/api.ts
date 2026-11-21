import { apiUrl } from "@/lib/apiBase";

export type MemoryKind = "profile" | "rule" | "fact";
export type MemoryOrigin = "user" | "nilo";
export type MemoryStatus = "active" | "proposed";

export type MemoryItem = {
  id: string;
  kind: MemoryKind;
  scope: string;
  text: string;
  origin: MemoryOrigin;
  status: MemoryStatus;
  pinned: boolean;
  source_thread_id: string | null;
  created_at: string;
  updated_at: string;
};

async function send(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const code = body?.detail?.code ?? "nilo.memory.error.notFound";
    throw new Error(code);
  }
  return response;
}

export const memoryApi = {
  list: async (query?: { scope?: string; kind?: string }) => {
    const params = new URLSearchParams();
    if (query?.scope) params.set("scope", query.scope);
    if (query?.kind) params.set("kind", query.kind);
    const suffix = params.size ? `?${params}` : "";
    return send(`/nilo/memory${suffix}`).then((response) => response.json() as Promise<MemoryItem[]>);
  },
  create: (body: { kind: MemoryKind; scope: string; text: string; pinned?: boolean }) =>
    send("/nilo/memory", { method: "POST", body: JSON.stringify(body) }).then((response) => response.json() as Promise<MemoryItem>),
  propose: (body: { kind: MemoryKind; scope: string; text: string; source_thread_id?: string }) =>
    send("/nilo/memory/proposals", { method: "POST", body: JSON.stringify(body) }).then((response) => response.json() as Promise<MemoryItem>),
  update: (id: string, body: { text?: string; pinned?: boolean; status?: "active" }) =>
    send(`/nilo/memory/${id}`, { method: "PATCH", body: JSON.stringify(body) }).then((response) => response.json() as Promise<MemoryItem>),
  forget: (id: string) => send(`/nilo/memory/${id}`, { method: "DELETE" }).then(() => undefined),
  forgetAll: (confirm: string) =>
    send(`/nilo/memory?all=true&confirm=${encodeURIComponent(confirm)}`, { method: "DELETE" }).then((response) => response.json() as Promise<{ deleted: number }>),
  exportAll: () => send("/nilo/memory/export").then((response) => response.json() as Promise<{ items: MemoryItem[] }>),
};
