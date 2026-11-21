import type { BadgeTone } from "@/components/ui";
import type { MessageKey } from "@/i18n/translate";
import type { FactoryAction, FactoryStatus, WorkItem, WorkItemEvent } from "./types";
import type { InboxEntry } from "./forjaApi";

/** Six stage columns. Status (claimed, needs you, parked, failed) is a badge on the card, not a column. */
export const DISPLAY_COLUMNS = ["intake", "spec", "implement", "review", "merge", "done"] as const;
export type DisplayColumn = (typeof DISPLAY_COLUMNS)[number];

const FORWARD: Record<DisplayColumn, DisplayColumn[]> = {
  intake: ["spec"],
  spec: ["implement"],
  implement: ["review"],
  review: ["merge", "implement"],
  merge: ["done", "review", "implement"],
  done: [],
};

export function displayColumn(item: Pick<WorkItem, "stage" | "status">): DisplayColumn {
  if (item.status === "done") return "done";
  if (item.stage === "intake" || item.stage === "triage") return "intake";
  if (item.stage === "spec") return "spec";
  if (item.stage === "implement") return "implement";
  if (item.stage === "review" || item.stage === "verify") return "review";
  return "merge";
}

export function groupByDisplay(items: WorkItem[]): Map<DisplayColumn, WorkItem[]> {
  const groups = new Map<DisplayColumn, WorkItem[]>();
  for (const column of DISPLAY_COLUMNS) groups.set(column, []);
  for (const item of items) {
    if (item.status === "cancelled") continue;
    groups.get(displayColumn(item))?.push(item);
  }
  return groups;
}

/** `allowed` when the blueprint permits the move, `blocked` otherwise. The card does not move by itself. */
export function moveReason(from: DisplayColumn, to: DisplayColumn): "same" | "allowed" | "blocked" {
  if (from === to) return "same";
  return FORWARD[from].includes(to) ? "allowed" : "blocked";
}

export function statusTone(status: FactoryStatus): BadgeTone {
  if (status === "failed") return "fault";
  if (status === "awaiting_human" || status === "waiting_merge") return "warn";
  if (status === "running") return "signal";
  return "neutral";
}

/** What a person can do with an item right now. There is no merge. */
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

/** The question a person has not answered yet. */
export function openQuestion(events: WorkItemEvent[]): { id: string; text: string } | null {
  const resolved = new Set(events.filter((e) => e.type === "checkpoint_resolved").map((e) => String(e.data.question_id ?? "")));
  const asked = [...events].reverse().find((e) => e.type === "checkpoint_requested" && e.data.kind === "question" && !resolved.has(String(e.data.question_id ?? "")));
  return asked ? { id: String(asked.data.question_id), text: String(asked.data.question ?? "") } : null;
}

const EVENT_KEYS: Record<string, MessageKey> = {
  created: "forja.event.created",
  spec_approved: "forja.event.specApproved",
  spec_edited: "forja.event.specEdited",
  advanced: "forja.event.advanced",
  completed: "forja.event.completed",
  failed: "forja.event.failed",
  note: "forja.event.note",
  changes_requested: "forja.event.changes",
  merge_observed: "forja.event.observed",
  inbox_resolved: "forja.event.inboxResolved",
  inbox_restored: "forja.event.inboxRestored",
  stage_entered: "forja.event.stage",
  parked: "forja.event.parked",
  resumed: "forja.event.resumed",
  cancelled: "forja.event.cancelled",
  run_stopped: "forja.event.runStopped",
};

/** A translated phrase. The raw event name never reaches the screen. */
export function eventKey(event: WorkItemEvent): MessageKey {
  const kind = String(event.data.kind ?? "");
  if (event.type === "checkpoint_requested" && kind === "question") return "forja.event.question";
  if (event.type === "checkpoint_requested") return "forja.event.checkpoint";
  if (event.type === "checkpoint_resolved") return "forja.event.resolved";
  return EVENT_KEYS[event.type] ?? "forja.event.update";
}

export function sourceKey(item: Pick<WorkItem, "source">): { key: MessageKey; n?: string } {
  const number = item.source.ref.match(/(\d+)\s*$/)?.[1];
  if (item.source.kind === "github") return number ? { key: "forja.source.githubNumber", n: number } : { key: "forja.source.github" };
  if (item.source.kind === "cli") return { key: "forja.source.cli" };
  if (item.source.kind === "webhook") return { key: "forja.source.webhook" };
  if (item.source.kind === "schedule") return { key: "forja.source.schedule" };
  return { key: "forja.source.other" };
}

/** Age as a message key. An unreadable stamp contributes nothing, so an ISO string is never shown. */
export function ageParts(iso: string, now = Date.now()): { key: MessageKey; n?: number } | null {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 1) return { key: "forja.time.justNow" };
  if (minutes < 60) return { key: "forja.time.minutes", n: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 48) return { key: "forja.time.hours", n: hours };
  return { key: "forja.time.days", n: Math.round(hours / 24) };
}

export interface InboxGroup {
  work_item_id: string;
  title: string;
  factory_id: string;
  stage: string;
  entries: InboxEntry[];
}

export function groupInbox(entries: InboxEntry[]): InboxGroup[] {
  const order: string[] = [];
  const groups = new Map<string, InboxGroup>();
  for (const entry of entries) {
    const key = entry.work_item_id;
    if (!groups.has(key)) {
      order.push(key);
      groups.set(key, { work_item_id: key, title: entry.title, factory_id: entry.factory_id ?? "", stage: entry.stage, entries: [] });
    }
    groups.get(key)?.entries.push(entry);
  }
  return order.map((key) => groups.get(key)!);
}
