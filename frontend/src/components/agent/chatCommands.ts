import { tr } from "@/i18n/store";
import { shellNavCommands } from "@/components/shell/commands";
import { useShellStore } from "@/components/shell/shellStore";
import { useThreadStore } from "@/store/threadStore";
import type { ChatCapabilities, DiscoverItem } from "@/lib/chatToolsApi";

/**
 * A user-chosen tool, sent as `tools.preset` on `/execute/direct`
 * (contract v1.1 §2.4). `exec` always pauses on the run's approval gate.
 */
export type ToolPreset =
  | { name: "exec"; argv: string[]; cwd?: string; timeout_s?: number }
  | { name: "read"; path: string; max_bytes?: number; truncate?: boolean }
  | { name: "discover" };

export interface ChatCommand {
  id: string;
  name: string;
  description: string;
  /** Contract §1: Command = UI action · Skill = insert text · Tool = run with a preset. */
  kind: "Command" | "Skill" | "Tool";
  /** What selecting it does, in the user's words — never "run" for a Skill. */
  hint?: "insert" | "run";
  run?: () => void;
  /** Skill text available synchronously (bundled with the loaded harness). */
  draft?: string;
  /** Skill text that must be read from the workspace first (contract §1 → `read`). */
  loadDraft?: () => Promise<string>;
  /** Tool: the preset the parent turns into a `/execute/direct` run. */
  preset?: ToolPreset;
  /** Tool that needs arguments typed after its name (`/exec npm test`). */
  takesArgs?: boolean;
}

/** What the composer knows about the selected workspace's tools. */
export interface ChatToolsInput {
  workspace: { root: string; name: string } | null;
  capabilities: ChatCapabilities | null;
  items: DiscoverItem[];
  /** Loads a workspace skill's text (`POST /chat/tools/read`). */
  readSkill: (path: string) => Promise<string>;
}

const SHELL_OPERATORS = new Set(["|", "||", "&&", ">", ">>", "<", ";", "&"]);

/**
 * Contract §1 splitter for `/exec`: double quotes group, backslash escapes
 * the next character inside quotes, nothing is expanded. Shell operators are
 * kept as literal argv items *and* reported, so the composer can warn that
 * there is no shell on the other side (contract §4: `shell=False`).
 */
export function splitArgv(text: string): { argv: string[]; shellSyntax: string[] } {
  const argv: string[] = [];
  let current = "";
  let inQuotes = false;
  let hasToken = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "\\" && i + 1 < text.length) { current += text[++i]; continue; }
      if (ch === '"') { inQuotes = false; continue; }
      current += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; hasToken = true; continue; }
    if (/\s/.test(ch)) {
      if (hasToken) { argv.push(current); current = ""; hasToken = false; }
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (hasToken) argv.push(current);
  return { argv, shellSyntax: argv.filter((a) => SHELL_OPERATORS.has(a)) };
}

export function chatCommands(skills: unknown, tools?: ChatToolsInput): ChatCommand[] {
  const nav = shellNavCommands();
  const aliases = [
    ["studio", "go:studio", tr("chat.cmd.studio")],
    ["harness", "harness:library", tr("chat.cmd.harness")],
    ["providers", "go:providers", tr("chat.cmd.providers")],
  ];
  const commands: ChatCommand[] = [
    { id: "new", name: "new", description: tr("chat.cmd.new"), kind: "Command", run: () => useThreadStore.getState().startNewChat() },
    ...aliases.map(([name, id, description]) => ({ id, name, description, kind: "Command" as const, run: nav.find(command => command.id === id)!.run })),
    { id: "shortcuts", name: "shortcuts", description: tr("chat.cmd.shortcuts"), kind: "Command", run: () => useShellStore.getState().setKeymapOpen(true) },
  ];
  if (skills && typeof skills === "object" && !Array.isArray(skills)) {
    for (const [name, content] of Object.entries(skills)) {
      if (typeof content !== "string" || !content.trim()) continue;
      commands.push({ id: "skill:" + name, name: "skill:" + name, description: tr("chat.cmd.skillFromHarness"), kind: "Skill", hint: "insert", draft: content });
    }
  }
  if (!tools?.workspace) return commands;

  const ws = tools.workspace;
  const preset = tools.capabilities?.preset ?? { read: false, exec: false };
  const { readSkill } = tools;

  for (const item of tools.items) {
    if (item.kind === "skill") {
      commands.push({
        id: "ws-skill:" + item.path, name: "skill:" + item.name, kind: "Skill", hint: "insert",
        description: tr("chat.cmd.skillFromWorkspace", { prefix: item.description ? item.description + " · " : "", ws: ws.name, source: item.source }),
        loadDraft: () => readSkill(item.path),
      });
    } else if (item.kind === "command") {
      if (item.argv?.length && preset.exec) {
        commands.push({
          id: "ws-cmd:" + item.path + ":" + item.name, name: item.name, kind: "Tool", hint: "run",
          description: tr("chat.cmd.toolItem", { argv: item.argv.join(" "), where: item.cwd ?? ws.name, source: item.source }),
          preset: { name: "exec", argv: item.argv, ...(item.cwd ? { cwd: item.cwd } : {}) },
        });
      } else if (!item.argv && preset.read) {
        commands.push({
          id: "ws-command:" + item.path,
          name: "command:" + item.name,
          kind: "Skill",
          hint: "insert",
          description: tr("chat.cmd.skillFromWorkspace", { prefix: item.description ? item.description + " · " : "", ws: ws.name, source: item.source }),
          loadDraft: () => readSkill(item.path),
        });
      }
    }
  }
  if (preset.exec) {
    commands.push({ id: "tool:exec", name: "exec", kind: "Tool", hint: "run", takesArgs: true,
      description: tr("chat.cmd.exec", { ws: ws.name }) });
  }
  if (preset.read) {
    commands.push({ id: "tool:read", name: "read", kind: "Tool", hint: "run", takesArgs: true,
      description: tr("chat.cmd.read", { ws: ws.name }) });
    commands.push({ id: "tool:ls", name: "ls", kind: "Tool", hint: "run",
      description: tr("chat.cmd.ls", { ws: ws.name }), preset: { name: "discover" } });
  }
  return commands;
}
