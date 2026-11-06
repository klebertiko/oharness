import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FACTORY_COLUMNS, FACTORY_STAGES, FACTORY_STATUSES, type WorkItem } from "./types";
import { actionsFor, BOARD_COLUMNS, groupByColumn, statusTone } from "./view";

const backend = readFileSync(path.resolve(__dirname, "../../../backend/factory/stages.py"), "utf8");
const PATTERNS = { STAGES: /STAGES = \(([^)]*)\)/, STATUSES: /STATUSES = \(([^)]*)\)/, COLUMNS: /COLUMNS = \(([^)]*)\)/ };
const tuple = (name: keyof typeof PATTERNS) => [...(PATTERNS[name].exec(backend)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

const item = (over: Partial<WorkItem>): WorkItem =>
  ({ id: "1", title: "t", column: "new", stage: "intake", status: "queued", spec: { text: "", revision: 0, approved_revision: null }, ...over }) as WorkItem;

describe("the vocabulary is the backend's single table", () => {
  it("has the same stages, statuses and columns as backend/factory/stages.py", () => {
    expect([...FACTORY_STAGES]).toEqual(tuple("STAGES"));
    expect([...FACTORY_STATUSES]).toEqual(tuple("STATUSES"));
    expect([...FACTORY_COLUMNS]).toEqual(tuple("COLUMNS"));
  });
  it("shows every column but the closed one on the board", () => {
    expect([...BOARD_COLUMNS, "closed"].sort()).toEqual([...FACTORY_COLUMNS].sort());
  });
});

describe("groupByColumn", () => {
  it("puts each item in its column and keeps cancelled and failed behind the filter", () => {
    const items = [item({ id: "a", column: "needs_you" }), item({ id: "b", column: "closed", status: "failed" })];
    expect(groupByColumn(items, false).get("needs_you")?.map((i) => i.id)).toEqual(["a"]);
    expect(groupByColumn(items, false).has("closed")).toBe(false);
    expect(groupByColumn(items, true).get("closed")?.map((i) => i.id)).toEqual(["b"]);
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
