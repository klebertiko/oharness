import type { MessageKey } from "@/i18n/translate";

/** What the plugin tool of creator mode (`cordis_plugins`) is asked to do, from the args of its call. */
export interface CordisArgs {
  action?: string;
  name?: string;
  path?: string;
  kind?: string;
}

const TITLE_KEY: Record<string, MessageKey> = {
  scaffold: "plugins.approval.scaffold",
  write_file: "plugins.approval.write_file",
  request_install: "plugins.approval.request_install",
  read_file: "plugins.approval.read_file",
  preview: "plugins.approval.preview",
  logs: "plugins.approval.logs",
  list: "plugins.approval.list",
  api_catalog: "plugins.approval.api_catalog",
  starters: "plugins.approval.starters",
};

/** The args arrive as the engine's JSON text; anything that is not an object with a text `action` reads as no action. */
export function parseCordisArgs(raw: string): CordisArgs {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!value || typeof value !== "object") return {};
  const o = value as Record<string, unknown>;
  if (typeof o.action !== "string") return {};
  return {
    action: o.action,
    ...(typeof o.name === "string" ? { name: o.name } : {}),
    ...(typeof o.path === "string" ? { path: o.path } : {}),
    ...(typeof o.kind === "string" ? { kind: o.kind } : {}),
  };
}

/** One plain sentence for the card title: "Write a file of the plugin x". The file content is never part of it. */
export function cordisTitle(raw: string, t: (key: MessageKey, vars?: Record<string, string>) => string): string {
  const { action, name } = parseCordisArgs(raw);
  const key = action ? TITLE_KEY[action] : undefined;
  if (!key) return t("plugins.approval.unknown");
  return t(key, { name: name ?? t("plugins.approval.noName") });
}
