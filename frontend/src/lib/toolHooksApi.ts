import { apiUrl } from "@/lib/apiBase";

export interface ToolHookRow {
  id: string;
  argv: string[];
  timeout_s: number;
  tools: string[];
  /** The stored row no longer validates; it blocks every tool until replaced. */
  invalid: boolean;
}

export const toolHooksApi = {
  async list(): Promise<ToolHookRow[]> {
    const res = await fetch(apiUrl("/chat/tools/hooks"), { cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status}`);
    return ((await res.json()) as { hooks: ToolHookRow[] }).hooks;
  },
  async put(id: string, body: { argv: string[]; timeout_s: number; tools: string[] }): Promise<void> {
    const res = await fetch(apiUrl(`/chat/tools/hooks/${encodeURIComponent(id)}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(res.status === 400 ? "The sidecar refused this hook." : `${res.status}`);
  },
  async remove(id: string): Promise<void> {
    const res = await fetch(apiUrl(`/chat/tools/hooks/${encodeURIComponent(id)}`), { method: "DELETE" });
    if (!res.ok) throw new Error(`${res.status}`);
  },
};
