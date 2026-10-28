import { describe, expect, it } from "vitest";
import { emptyRun, runReducer } from "@/components/agent-run/runReducer";
import { policyRefusals } from "./policyRefusals";

const seeded = runReducer(emptyRun, { type: "sse", event: "run_start",
  data: { run_id: "r1", mode: "live", step: false, order: [{ node_id: "direct", type: "agent", label: "Chat", adapter: "http", model: "" }], unreachable: [] } });
const called = (id: string, argv: string[]) => (state: typeof seeded) =>
  runReducer(state, { type: "sse", event: "tool_call", data: { node_id: "direct", call_id: id, name: "exec", args: { argv }, origin: "model" } });
const denied = (id: string, reason: string, note: string, mode?: string) => (state: typeof seeded) =>
  runReducer(state, { type: "sse", event: "tool_denied", data: { node_id: "direct", call_id: id, reason, note, ...(mode ? { mode } : {}) } });

describe("policyRefusals", () => {
  it("names the command and the reason of a call the permission mode refused", () => {
    const state = denied("c1", "policy", "Read-only preset: this command could change files, so it was not run.", "read_only")(called("c1", ["touch", "a.txt"])(seeded));
    expect(policyRefusals(state)).toEqual([{ callId: "c1", command: "touch a.txt", note: "Read-only preset: this command could change files, so it was not run.", mode: "read_only" }]);
  });

  it("ignores a policy denial that is about invalid arguments, not about the mode", () => {
    const invalid = denied("c1", "policy", "policy: invalid or unauthorized tool arguments")(called("c1", ["touch", "a"])(seeded));
    expect(policyRefusals(invalid)).toEqual([]);
  });

  it("ignores calls a person rejected and calls that ran", () => {
    const rejected = denied("c1", "rejected", "no")(called("c1", ["touch", "a"])(seeded));
    expect(policyRefusals(rejected)).toEqual([]);
    expect(policyRefusals(seeded)).toEqual([]);
  });
});
