import type { MessageKey } from "@/i18n/messages.en";
import type { SourceRef } from "@/store/pluginsTypes";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

const LOG: Record<string, MessageKey> = {
  downloading: "plugins.log.downloading",
  inspecting: "plugins.log.inspecting",
  loading: "plugins.log.loading",
  ready: "plugins.log.ready",
};

const ERRORS: Record<string, MessageKey> = {
  decide: "plugins.error.decide",
  human: "plugins.error.human",
  offline: "plugins.error.offline",
  cancelled: "plugins.error.cancelled",
};

const STATES: Record<string, MessageKey> = {
  active: "plugins.state.active",
  disabled: "plugins.state.disabled",
  failed: "plugins.state.failed",
  changed: "plugins.state.changed",
  unavailable: "plugins.state.unavailable",
};

export function errorText(t: T, error: string | null): string | null {
  if (!error) return null;
  return t(ERRORS[error] ?? "plugins.error.generic");
}

export function logLine(t: T, line: string): string {
  return LOG[line] ? t(LOG[line]) : line;
}

export function stateLabel(t: T, state: string): string {
  return STATES[state] ? t(STATES[state]) : t("plugins.state.other", { state });
}

export function sourceText(t: T, source: SourceRef): string {
  if (source.kind === "npm") return `${t("plugins.add.kind.npm")} · ${source.spec}@${source.version ?? ""}`;
  if (source.kind === "github") return `${t("plugins.add.kind.git")} · ${source.spec}@${(source.commit ?? "").slice(0, 12)}`;
  if (source.kind === "tarball") return `${t("plugins.add.kind.tarball")} · ${source.spec}`;
  return `${t("plugins.add.kind.local")} · ${source.spec}`;
}
