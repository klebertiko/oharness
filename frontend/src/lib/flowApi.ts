/**
 * The Flow switch's global default — FastAPI sidecar via `apiBase`. Off until
 * someone turns it on. Flow only adds `flow_advice` events to a harness run;
 * it never changes what runs (backend/flow, ADR 0065).
 */

import { apiUrl } from "@/lib/apiBase";

export type FlowConfig = { enabled: boolean };

async function request(init?: RequestInit): Promise<FlowConfig> {
  const res = await fetch(apiUrl("/flow/config"), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<FlowConfig>;
}

export const flowApi = {
  get: () => request(),
  set: (enabled: boolean) => request({ method: "PUT", body: JSON.stringify({ enabled }) }),
};
