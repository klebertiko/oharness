import { describe, expect, it } from "vitest";
import { NO_HARNESS, harnessFromSession, harnessLabel, resolveHarness, sameHarness, switchNotice } from "./chatHarness";

const agile = { kind: "harness", id: "oharness.default.agile", name: "Agile Harness" } as const;
const lib = [{ id: "oharness.default.agile", name: "Agile Harness" }];

describe("chat harness binding", () => {
  it("reads the session choice as a binding", () => {
    expect(harnessFromSession(false, { manifest: { id: "x", name: "X" } })).toEqual(NO_HARNESS);
    expect(harnessFromSession(true, null)).toEqual(NO_HARNESS);
    expect(harnessFromSession(true, { manifest: { id: "x", name: "X" } })).toEqual({ kind: "harness", id: "x", name: "X" });
    expect(harnessFromSession(true, { manifest: { id: "x" } })).toEqual({ kind: "harness", id: "x", name: "x" });
  });

  it("resolves a binding against what is available", () => {
    expect(resolveHarness(NO_HARNESS, lib, true)).toEqual({ state: "none" });
    expect(resolveHarness(agile, lib, true)).toEqual({ state: "ready", id: agile.id, name: "Agile Harness" });
    expect(resolveHarness({ kind: "harness", id: "gone", name: "Old" }, lib, true)).toEqual({ state: "missing", id: "gone", name: "Old" });
  });

  it("does not call a harness missing while the library is still loading", () => {
    expect(resolveHarness({ kind: "harness", id: "gone", name: "Old" }, [], false)).toEqual({ state: "loading", id: "gone", name: "Old" });
  });

  it("compares and labels bindings", () => {
    expect(sameHarness(NO_HARNESS, { kind: "none" })).toBe(true);
    expect(sameHarness(agile, { ...agile, name: "Renamed" })).toBe(true);
    expect(sameHarness(agile, NO_HARNESS)).toBe(false);
    expect(harnessLabel(NO_HARNESS)).toBe("No harness");
    expect(harnessLabel(agile)).toBe("Agile Harness");
  });

  it("says when a change takes effect, in plain words", () => {
    expect(switchNotice(agile)).toBe("Harness changed to Agile Harness. It applies from your next message; earlier replies stay as they were.");
    expect(switchNotice(NO_HARNESS)).toBe("Harness changed to No harness. It applies from your next message; earlier replies stay as they were.");
  });
});
