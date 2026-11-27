import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FACTORY_COLUMNS, FACTORY_STAGES, FACTORY_STATUSES, type WorkItem } from "./types";
import { actionsFor, ageParts, displayColumn, DISPLAY_COLUMNS, eventKey, groupByDisplay, groupInbox, moveReason, sourceKey, statusTone } from "./view";
import type { WorkItemEvent } from "./types";

const backend = readFileSync(path.resolve(__dirname, "../../../backend/factory/stages.py"), "utf8");
const PATTERNS = { STAGES: /STAGES = \(([^)]*)\)/, STATUSES: /STATUSES = \(([^)]*)\)/, COLUMNS: /COLUMNS = \(([^)]*)\)/ };
const tuple = (name: keyof typeof PATTERNS) => [...(PATTERNS[name].exec(backend)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

const item = (over: Partial<WorkItem>): WorkItem =>
  ({ id: "1", title: "t", column: "new", stage: "intake", status: "queued", source: { kind: "cli", subtype: null, ref: "cli:1", url: null, thread_ref: null }, spec: { text: "", revision: 0, approved_revision: null }, ...over }) as WorkItem;

describe("the vocabulary is the backend's single table", () => {
  it("has the same stages, statuses and columns as backend/factory/stages.py", () => {
    expect([...FACTORY_STAGES]).toEqual(tuple("STAGES"));
    expect([...FACTORY_STATUSES]).toEqual(tuple("STATUSES"));
    expect([...FACTORY_COLUMNS]).toEqual(tuple("COLUMNS"));
  });
  it("shows six stage columns, and keeps status off the board", () => {
    expect(DISPLAY_COLUMNS).toEqual(["intake", "spec", "implement", "review", "merge", "done"]);
    expect(displayColumn(item({ stage: "intake", status: "queued" }))).toBe("intake");
    expect(displayColumn(item({ stage: "spec", status: "awaiting_human" }))).toBe("spec");
    expect(displayColumn(item({ stage: "implement", status: "running" }))).toBe("implement");
    expect(displayColumn(item({ stage: "handoff", status: "waiting_merge" }))).toBe("merge");
    expect(displayColumn(item({ stage: "handoff", status: "done" }))).toBe("done");
    expect(displayColumn(item({ stage: "implement", status: "failed" }))).toBe("implement");
  });
});

describe("groupByDisplay", () => {
  it("puts a failed item in its stage column and hides a cancelled one", () => {
    const items = [item({ id: "a", stage: "spec", status: "awaiting_human" }), item({ id: "b", stage: "implement", status: "failed" }), item({ id: "c", status: "cancelled" })];
    expect(groupByDisplay(items).get("spec")?.map((row) => row.id)).toEqual(["a"]);
    expect(groupByDisplay(items).get("implement")?.map((row) => row.id)).toEqual(["b"]);
    expect([...groupByDisplay(items).values()].flat().map((row) => row.id)).not.toContain("c");
  });
});

describe("moves", () => {
  it("allows the next column and explains a skip", () => {
    expect(moveReason("intake", "spec")).toBe("allowed");
    expect(moveReason("intake", "review")).toBe("blocked");
    expect(moveReason("review", "implement")).toBe("allowed");
  });
});

describe("words on screen", () => {
  it("never uses the raw event name or an ISO stamp", () => {
    const event = { sequence: 1, type: "checkpoint_requested", actor: { kind: "foreman", id: null }, data: { kind: "spec" }, at: "2026-11-01T10:00:00Z" } as WorkItemEvent;
    expect(eventKey(event)).toBe("forja.event.checkpoint");
    expect(eventKey({ ...event, type: "something_new" })).toBe("forja.event.update");
    expect(JSON.stringify(ageParts(event.at, Date.parse("2026-11-01T12:00:00Z")))).not.toMatch(/T\d\d:/);
    expect(sourceKey(item({ source: { kind: "github", subtype: null, ref: "o/r#123", url: null, thread_ref: null } }))).toEqual({ key: "forja.source.githubNumber", n: "123" });
  });
});

describe("groupInbox", () => {
  it("groups rows that belong to the same item", () => {
    const entry = { id: "a", type: "question" as const, work_item_id: "i1", factory_id: "payments", title: "Fix login", stage: "triage", status: "awaiting_human", since: "x", summary: "Which?", actions: [], resolved: false };
    const groups = groupInbox([entry, { ...entry, id: "b", type: "spec_review" }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((row) => row.id)).toEqual(["a", "b"]);
  });
});

describe("actionsFor", () => {
  it("offers the approval only on a spec waiting for a person, and confirm-merged only on the handoff", () => {
    expect(actionsFor(item({ stage: "spec", status: "awaiting_human", spec: { text: "x", revision: 1, approved_revision: null } }))).toContain("approve_spec");
    expect(actionsFor(item({ stage: "spec", status: "awaiting_human" }))).not.toContain("approve_spec");
    expect(actionsFor(item({ stage: "handoff", status: "waiting_merge" }))).toEqual(expect.arrayContaining(["confirm_merged", "request_changes"]));
    expect(actionsFor(item({ stage: "implement", status: "queued" }))).not.toContain("confirm_merged");
  });
  it("never offers a merge, and a closed item only takes a note", () => {
    for (const status of FACTORY_STATUSES) for (const stage of FACTORY_STAGES) for (const action of actionsFor(item({ stage, status }))) expect(action).not.toMatch(/^merge/);
    expect(actionsFor(item({ status: "done" }))).toEqual(["note"]);
  });
  it("lets a parked item resume and a claimed one only be noted or cancelled", () => {
    expect(actionsFor(item({ status: "parked" }))).toContain("resume");
    expect(actionsFor(item({ status: "claimed" }))).not.toContain("park");
  });
});

describe("statusTone", () => {
  it("never leaves a state without a tone", () => {
    for (const status of FACTORY_STATUSES) expect(["neutral", "signal", "warn", "fault"]).toContain(statusTone(status));
  });
});
