/** Mirror of backend/sandbox/hooks.py HOOK_RULES — pinned by test_tool_hooks_parity.py. */
export const HOOK_RULES = {
  idPattern: /^[a-z0-9][a-z0-9_-]{0,63}$/,
  timeoutS: { min: 1, max: 10, default: 5 },
  tools: ["exec", "read", "discover"],
  argvMaxItems: 16,
  deniedPrograms: ["sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh", "env", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe"],
} as const;

export interface HookDraft {
  id: string;
  program: string;
  args: string;
  timeoutS: string;
  tools: string[];
}

export type HookCheck =
  | { ok: true; id: string; body: { argv: string[]; timeout_s: number; tools: string[] } }
  | { ok: false; message: string };

const isAbsolute = (p: string) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");

/** Same checks as the sidecar's `validate_hook`; the sidecar stays the authority. */
export function checkHook(draft: HookDraft): HookCheck {
  if (!HOOK_RULES.idPattern.test(draft.id)) return { ok: false, message: "Id: lowercase letters, digits, - or _ (up to 64)." };
  const program = draft.program.trim();
  const name = program.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (!isAbsolute(program)) return { ok: false, message: "Program must be a full path." };
  if ((HOOK_RULES.deniedPrograms as readonly string[]).includes(name)) return { ok: false, message: "A shell cannot be a hook program." };
  const args = draft.args.split("\n").map((a) => a.trim()).filter(Boolean);
  if (args.length + 1 > HOOK_RULES.argvMaxItems) return { ok: false, message: `At most ${HOOK_RULES.argvMaxItems - 1} arguments.` };
  const timeout = Number(draft.timeoutS);
  const { min, max } = HOOK_RULES.timeoutS;
  if (!Number.isFinite(timeout) || timeout < min || timeout > max) return { ok: false, message: `Timeout: ${min} to ${max} seconds.` };
  if (!draft.tools.length) return { ok: false, message: "Pick at least one tool." };
  return { ok: true, id: draft.id, body: { argv: [program, ...args], timeout_s: timeout, tools: draft.tools } };
}
