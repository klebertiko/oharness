import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSION_MODE, PERMISSION_CYCLE, PERMISSION_HINT, PERMISSION_LABEL, PERMISSION_MODES, PERMISSION_SUMMARY,
  isPermissionMode, nextPermissionMode,
} from "./permissionMode";

const backendFile = path.resolve(__dirname, "../../../backend/sandbox/permission_modes.json");
const uiFile = path.resolve(__dirname, "./permissionModes.json");

describe("permission modes: one table for the UI and the validator", () => {
  it("the UI copy is byte-identical to the backend table", () => {
    expect(readFileSync(uiFile, "utf8")).toBe(readFileSync(backendFile, "utf8"));
  });

  it("lists the six modes, strictest first, with a label, hint and summary each", () => {
    expect(PERMISSION_MODES).toEqual(["plan", "read_only", "ask", "auto_workspace", "workspace_write", "full"]);
    for (const mode of PERMISSION_MODES) {
      expect(PERMISSION_LABEL[mode]).toBeTruthy();
      expect(PERMISSION_HINT[mode]).toBeTruthy();
      expect(PERMISSION_SUMMARY[mode]).toBeTruthy();
    }
    expect(PERMISSION_LABEL.read_only).toBe("Read-only");
    expect(PERMISSION_LABEL.workspace_write).toBe("Workspace write");
    expect(DEFAULT_PERMISSION_MODE).toBe("ask");
  });

  it("has no bypass mode and never reaches Full with the keyboard cycle", () => {
    expect(isPermissionMode("bypass")).toBe(false);
    expect(isPermissionMode("dangerously-bypass")).toBe(false);
    expect(PERMISSION_CYCLE).not.toContain("full");
    let mode = DEFAULT_PERMISSION_MODE;
    for (let i = 0; i < 12; i++) { mode = nextPermissionMode(mode); expect(mode).not.toBe("full"); }
    expect(nextPermissionMode("full")).toBe("ask");
  });

  it("never names a retired word in user-facing copy", () => {
    const text = JSON.stringify([PERMISSION_LABEL, PERMISSION_HINT, PERMISSION_SUMMARY]).toLowerCase();
    expect(text).not.toMatch(/copilot|bypass|dangerous/);
  });
});
