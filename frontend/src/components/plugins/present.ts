"use client";
import { useCallback } from "react";
import type { StatusTone } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import type { MessageKey } from "@/i18n/translate";
import type { Problem } from "@/store/pluginsStore";
import type { HostState, PluginSource, PluginState } from "./types";

export const STATE_KEY: Record<PluginState, MessageKey> = {
  active: "plugins.state.active",
  pending: "plugins.state.pending",
  failed: "plugins.state.failed",
  disabled: "plugins.state.disabled",
  changed: "plugins.state.changed",
  unavailable: "plugins.state.unavailable",
};
export const STATE_BADGE: Record<PluginState, BadgeTone> = { active: "signal", pending: "neutral", failed: "fault", disabled: "neutral", changed: "warn", unavailable: "warn" };

export const HOST_KEY: Record<HostState, MessageKey> = {
  starting: "plugins.host.starting",
  running: "plugins.host.running",
  unavailable: "plugins.host.unavailable",
  failed: "plugins.host.failed",
};
export const HOST_MARK: Record<HostState, StatusTone> = { starting: "busy", running: "ok", unavailable: "warn", failed: "fault" };

export const CAPABILITIES = ["files", "network", "processes", "credentials"] as const;
const isCapability = (value: string): value is (typeof CAPABILITIES)[number] => (CAPABILITIES as readonly string[]).includes(value);

/** Machine data (spec, version, commit) is shown as is; only the kind of source is a word. */
export function sourceText(source: PluginSource, kind: string): string {
  if (source.kind === "npm") return `${kind} ${source.spec}${source.version ? `@${source.version}` : ""}`;
  if (source.kind === "github") return `${kind} ${source.spec}@${(source.commit ?? "").slice(0, 7)}${source.subdir ? `/${source.subdir}` : ""}`;
  return `${kind} ${source.spec}`;
}

export function usePresent() {
  const { t } = useI18n();
  const capabilityLabel = useCallback((cap: string) => (isCapability(cap) ? t(`plugins.capability.${cap}`) : cap), [t]);
  const capabilityGrant = useCallback((cap: string) => (isCapability(cap) ? t(`plugins.capability.${cap}.grant`) : t("plugins.capability.unknown")), [t]);
  const source = useCallback((s: PluginSource) => sourceText(s, t(`plugins.source.${s.kind}`)), [t]);
  /** A plain sentence for a failed call: a missing human credential is its own message. */
  const explain = useCallback((p: Problem) => (p.code === "human_only" ? t("plugins.noCredential") : t("plugins.actionFailed", { reason: p.message })), [t]);
  return { capabilityLabel, capabilityGrant, source, explain };
}
