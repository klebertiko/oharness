import type { RunState } from "@/components/agent-run/types";

export interface PolicyRefusal { callId: string; command: string; note: string }

/** Commands the permission mode refused (not ones a person rejected), with the reason the sidecar gave. */
export function policyRefusals(run: Pick<RunState, "plan">): PolicyRefusal[] {
  const out: PolicyRefusal[] = [];
  for (const segment of run.plan)
    for (const block of segment.blocks)
      if (block.kind === "tool" && block.call.denied?.reason === "policy" && block.call.denied.note)
        out.push({ callId: block.call.callId, command: block.call.argv?.join(" ") ?? block.call.path ?? block.call.name, note: block.call.denied.note });
  return out;
}
