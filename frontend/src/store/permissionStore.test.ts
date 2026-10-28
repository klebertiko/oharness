import { beforeEach, describe, expect, it } from "vitest";
import { nextPermissionMode, PERMISSION_CYCLE, PERMISSION_MODES } from "@/lib/permissionMode";
import { PERMISSION_STORAGE_KEY, usePermissionStore } from "./permissionStore";

beforeEach(() => {
  localStorage.clear();
  usePermissionStore.setState({ byThread: {}, draft: "ask" });
});

describe("permission mode cycle", () => {
  it("cycles ask -> auto_workspace -> plan -> ask and has no bypass mode", () => {
    expect(PERMISSION_CYCLE).toEqual(["ask", "auto_workspace", "plan"]);
    expect(PERMISSION_MODES).not.toContain("bypass");
    expect(nextPermissionMode("ask")).toBe("auto_workspace");
    expect(nextPermissionMode("auto_workspace")).toBe("plan");
    expect(nextPermissionMode("plan")).toBe("ask");
  });
});

describe("permissionStore", () => {
  it("new conversations default to ask, before and after they have a thread", () => {
    expect(usePermissionStore.getState().modeFor(null)).toBe("ask");
    expect(usePermissionStore.getState().modeFor("t-new")).toBe("ask");
  });

  it("keeps the mode per conversation", () => {
    usePermissionStore.getState().setMode("t1", "plan");
    usePermissionStore.getState().setMode("t2", "auto_workspace");
    expect(usePermissionStore.getState().modeFor("t1")).toBe("plan");
    expect(usePermissionStore.getState().modeFor("t2")).toBe("auto_workspace");
    expect(usePermissionStore.getState().modeFor("t3")).toBe("ask");
  });

  it("the no-thread draft is its own value", () => {
    usePermissionStore.getState().setMode(null, "plan");
    expect(usePermissionStore.getState().modeFor(null)).toBe("plan");
    expect(usePermissionStore.getState().modeFor("t1")).toBe("ask");
  });

  it("persists per conversation across reloads", async () => {
    usePermissionStore.getState().setMode("t1", "auto_workspace");
    const raw = JSON.parse(localStorage.getItem(PERMISSION_STORAGE_KEY) ?? "{}");
    expect(raw.state.byThread).toEqual({ t1: "auto_workspace" });
    const stored = localStorage.getItem(PERMISSION_STORAGE_KEY) ?? "";
    usePermissionStore.setState({ byThread: {}, draft: "ask" }); // also rewrites storage
    localStorage.setItem(PERMISSION_STORAGE_KEY, stored);
    await usePermissionStore.persist.rehydrate();
    expect(usePermissionStore.getState().modeFor("t1")).toBe("auto_workspace");
  });

  it("never persists the draft: a fresh app starts a new conversation on ask", () => {
    usePermissionStore.getState().setMode(null, "auto_workspace");
    expect(JSON.parse(localStorage.getItem(PERMISSION_STORAGE_KEY) ?? "{}").state.draft).toBeUndefined();
  });

  it("ignores an unknown stored value instead of widening permissions", async () => {
    localStorage.setItem(PERMISSION_STORAGE_KEY, JSON.stringify({ state: { byThread: { t1: "bypass", t2: "plan" } }, version: 1 }));
    await usePermissionStore.persist.rehydrate();
    expect(usePermissionStore.getState().modeFor("t1")).toBe("ask");
    expect(usePermissionStore.getState().modeFor("t2")).toBe("plan");
  });

  it("forget drops a deleted conversation", () => {
    usePermissionStore.getState().setMode("t1", "plan");
    usePermissionStore.getState().forget("t1");
    expect(usePermissionStore.getState().modeFor("t1")).toBe("ask");
  });
});
