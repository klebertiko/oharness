import type { BadgeTone } from "@/components/ui";
import type { FactoryAction, FactoryColumn, FactoryStatus, WorkItem } from "./types";

/** The board shows these columns, left to right; `closed` (cancelled, failed) stays behind a filter (ADR 0053). */
export const BOARD_COLUMNS: FactoryColumn[] = ["new", "triaged", "planned", "implementing", "in_review", "verifying", "handoff", "monitoring", "claimed", "needs_you", "parked", "done"];

export function groupByColumn(items: WorkItem[], showClosed: boolean): Map<FactoryColumn, WorkItem[]> {
  const groups = new Map<FactoryColumn, WorkItem[]>();
  for (const column of showClosed ? [...BOARD_COLUMNS, "closed" as const] : BOARD_COLUMNS) groups.set(column, []);
  for (const item of items) groups.get(item.column)?.push(item);
  return groups;
}

export function statusTone(status: FactoryStatus): BadgeTone {
  if (status === "failed") return "fault";
  if (status === "awaiting_human" || status === "waiting_merge") return "warn";
  if (status === "running") return "signal";
  return "neutral";
}

/** What a person can do with an item right now. Transitions are actions with a checkpoint, never a drag (ADR 0058); there is no merge. */
export function actionsFor(item: WorkItem): FactoryAction[] {
  if (item.status === "done" || item.status === "cancelled" || item.status === "failed") return ["note"];
  const out: FactoryAction[] = [];
  if (item.stage === "spec" && item.status === "awaiting_human" && item.spec.text) out.push("approve_spec");
  if (item.stage === "handoff" && item.status === "waiting_merge") out.push("confirm_merged", "request_changes");
  if (item.status === "parked") out.push("resume");
  else if (item.status !== "claimed") out.push("park");
  out.push("note", "cancel");
  return out;
}
