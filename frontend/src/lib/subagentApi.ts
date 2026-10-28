import { apiUrl } from "@/lib/apiBase";

export const subagentApi = {
  /** Cancel one subagent of a live run. The parent run and the other children are not touched. */
  async cancel(runId: string, childId: string): Promise<{ ok: boolean; reason?: "finished" | "failed" }> {
    try {
      const res = await fetch(apiUrl(`/execute/${encodeURIComponent(runId)}/subagents/${encodeURIComponent(childId)}/cancel`), { method: "POST" });
      if (res.ok) return { ok: true };
      return { ok: false, reason: res.status === 409 ? "finished" : "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  },
};
