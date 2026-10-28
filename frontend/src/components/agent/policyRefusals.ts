import type { RunState } from "@/components/agent-run/types";

export interface PolicyRefusal { callId: string; command: string; note: string; mode: string }

/** Commands a permission mode refused (not ones a person rejected, nor invalid arguments), with the mode and reason the sidecar gave. */
export function policyRefusals(run: Pick<RunState, "plan">): PolicyRefusal[] {
  const out: PolicyRefusal[] = [];
  for (const segment of run.plan)
    for (const block of segment.blocks)
      if (block.kind === "tool" && block.call.denied?.reason === "policy" && block.call.denied.mode && block.call.denied.note)
        out.push({ callId: block.call.callId, command: block.call.argv?.join(" ") ?? block.call.path ?? block.call.name, note: block.call.denied.note, mode: block.call.denied.mode });
  return out;
}
