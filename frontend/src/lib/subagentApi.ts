import { apiUrl } from "@/lib/apiBase";

export const subagentApi = {
  /** Cancel one subagent of a live run. The parent run and the other children are not touched. */
  async cancel(runId: string, childId: string): Promise<{ ok: boolean }> {
    try {
      const res = await fetch(apiUrl(`/execute/${encodeURIComponent(runId)}/subagents/${encodeURIComponent(childId)}/cancel`), { method: "POST" });
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  },
};
