/**
 * Chat permission mode. The frontend only selects and displays it; the sidecar
 * enforces it (backend/sandbox/permission.py) and stores it per conversation.
 * Ids, labels, hints and summaries come from ONE table, `permissionModes.json`,
 * a byte-identical copy of backend/sandbox/permission_modes.json (a parity test
 * fails when they differ). There is deliberately no "bypass everything" mode.
 */
import table from "./permissionModes.json";

export type PermissionMode = "plan" | "read_only" | "ask" | "auto_workspace" | "workspace_write" | "full";

interface ModeRow { id: PermissionMode; label: string; hint: string; summary: string }
const rows = table.modes as unknown as ModeRow[];

/** Strictest first, as in the table. The order of the selector. */
export const PERMISSION_MODES: PermissionMode[] = rows.map((row) => row.id);

/** Shift+Tab cycle: safest default first. Full is never reached by the keyboard cycle, only by an explicit, confirmed choice. */
export const PERMISSION_CYCLE: PermissionMode[] = ["ask", "auto_workspace", "plan"];

export const DEFAULT_PERMISSION_MODE = table.default as PermissionMode;

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && (PERMISSION_MODES as string[]).includes(value);
}

export function nextPermissionMode(mode: PermissionMode): PermissionMode {
  const at = PERMISSION_CYCLE.indexOf(mode);
  return at < 0 ? DEFAULT_PERMISSION_MODE : PERMISSION_CYCLE[(at + 1) % PERMISSION_CYCLE.length];
}

const by = (pick: (row: ModeRow) => string) => Object.fromEntries(rows.map((row) => [row.id, pick(row)])) as Record<PermissionMode, string>;

export const PERMISSION_LABEL = by((row) => row.label);
export const PERMISSION_HINT = by((row) => row.hint);
/** The always-visible one-liner beside the selector. */
export const PERMISSION_SUMMARY = by((row) => row.summary);
