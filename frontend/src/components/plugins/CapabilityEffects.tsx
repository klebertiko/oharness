"use client";
import { Badge, type BadgeTone } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import type { MessageKey } from "@/i18n/translate";
import { type EffectStatus, capabilityEffects, usePresent } from "./present";

const STATUS_KEY: Record<EffectStatus, MessageKey> = {
  blocked: "plugins.effect.blocked",
  accepted: "plugins.effect.accepted",
  asked: "plugins.effect.asked",
  declaredOnly: "plugins.effect.declaredOnly",
  unlimited: "plugins.effect.unlimited",
};
const STATUS_TONE: Record<EffectStatus, BadgeTone> = { blocked: "neutral", accepted: "warn", asked: "warn", declaredOnly: "warn", unlimited: "fault" };

/** The four capabilities with what each one does to this plugin: blocked, accepted, only declared (the network) or no limits (in-process). */
export function CapabilityEffects({ runtime, capabilities, confirmed = true }: { runtime: string; capabilities: string[]; confirmed?: boolean }) {
  const { t } = useI18n();
  const { capabilityLabel } = usePresent();
  return (
    <ul aria-label={t("plugins.effect.title")} className="flex flex-col gap-2">
      {capabilityEffects(runtime, capabilities, { confirmed }).map((effect) => (
        <li key={effect.cap} className="flex flex-col gap-1 rounded-control border border-line-soft bg-sub-100 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body font-medium text-ink">{capabilityLabel(effect.cap)}</span>
            <Badge tone={STATUS_TONE[effect.status]}>{t(STATUS_KEY[effect.status])}</Badge>
          </div>
          <p className="text-body text-ink-dim">{t(effect.textKey)}</p>
        </li>
      ))}
    </ul>
  );
}
