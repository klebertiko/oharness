/**
 * Chat permission mode. The frontend only selects and displays it; the sidecar
 * enforces it (backend/sandbox/permission.py) and stores it per conversation.
 * There is deliberately no "bypass everything" mode.
 */
export type PermissionMode = "plan" | "ask" | "auto_workspace";

/** Cycle order (Shift+Tab): safest default first, read-only last. */
export const PERMISSION_MODES: PermissionMode[] = ["ask", "auto_workspace", "plan"];

export const DEFAULT_PERMISSION_MODE: PermissionMode = "ask";

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && (PERMISSION_MODES as string[]).includes(value);
}

export function nextPermissionMode(mode: PermissionMode): PermissionMode {
  return PERMISSION_MODES[(PERMISSION_MODES.indexOf(mode) + 1) % PERMISSION_MODES.length];
}

export const PERMISSION_LABEL: Record<PermissionMode, string> = {
  ask: "Ask",
  auto_workspace: "Auto",
  plan: "Plan",
};

export const PERMISSION_HINT: Record<PermissionMode, string> = {
  ask: "Ask: every command waits for your approval",
  auto_workspace:
    "Auto: read-only git and listings run without asking. In a trusted workspace it also runs the project's own scripts (npm, pytest) without asking. Everything else asks",
  plan: "Plan: read-only. Commands are refused; files can still be read",
};

/** The always-visible one-liner beside the selector. */
export const PERMISSION_SUMMARY: Record<PermissionMode, string> = {
  ask: "asks before every command",
  auto_workspace: "read-only commands run on their own",
  plan: "read-only",
};
