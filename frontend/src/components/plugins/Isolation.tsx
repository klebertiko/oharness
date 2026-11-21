"use client";

import type { MessageKey } from "@/i18n/messages.en";
import { useT } from "@/i18n/store";
import { CAPABILITIES, capabilityNote, type Capability, type CapabilityNote } from "./isolation";

const NOTE: Record<CapabilityNote, MessageKey> = {
  enforced: "plugins.isolation.enforced",
  granted: "plugins.isolation.granted",
  declared: "plugins.isolation.declared",
  notEnforced: "plugins.isolation.notEnforced",
};

const LABEL: Record<Capability, MessageKey> = {
  files: "plugins.isolation.files",
  network: "plugins.isolation.network",
  processes: "plugins.isolation.processes",
  credentials: "plugins.isolation.credentials",
};

/** The reach of one plugin: runtime, and each capability as on or off with what that means. */
export function Isolation({ runtime, capabilities }: { runtime: string; capabilities: readonly string[] }) {
  const t = useT();
  const granted = new Set(capabilities);
  return (
    <section aria-label={t("plugins.isolation.title")} className="flex min-w-0 flex-col gap-2">
      <p className="text-body text-ink-dim">{runtime === "in-process" ? t("plugins.isolation.inProcess") : t("plugins.isolation.isolated")}</p>
      <ul className="flex min-w-0 flex-col gap-1">
        {CAPABILITIES.map((capability) => {
          const on = granted.has(capability);
          const note = capabilityNote(runtime, capability, on);
          return (
            <li key={capability} className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-body">
              <span className="font-medium text-ink">{t(LABEL[capability])}</span>
              <span className="text-ink-dim">{on ? t("plugins.isolation.on") : t("plugins.isolation.off")}</span>
              <span className="text-ink-mute">{t(NOTE[note])}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
