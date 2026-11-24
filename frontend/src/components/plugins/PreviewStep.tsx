"use client";
import { useId, useState } from "react";
import { Button, Notice } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import { type ScriptDecision, scriptKey, usePluginsStore } from "@/store/pluginsStore";
import { CapabilityEffects } from "./CapabilityEffects";
import { Checkbox } from "./Checkbox";
import { usePresent } from "./present";
import type { FetchResult } from "./types";

const NO_DECISIONS: Record<string, ScriptDecision> = {};

/**
 * What the person confirms: name, version, source, runtime, what each capability grants, the scripts that will not run (one decision for
 * each) and the host's own warning in the current language. Install stays off until the box is ticked and every script has an answer; the
 * digest of exactly this warning and these files goes with it.
 */
export function PreviewStep({ fetched, installing, error, onBack, onInstall, onDecline, confirmLabel, backLabel, declineLabel, heading, locked = false }: {
  fetched: FetchResult; installing: boolean; error: string | null; onBack: () => void; onInstall: () => void;
  /** "Do not install" on a script: drops what was downloaded and goes back, saying nothing was installed. */
  onDecline: () => void;
  /** A request from Nilo reuses this review with Approve/Reject and its own heading. */
  confirmLabel?: string; backLabel?: string; declineLabel?: string; heading?: string;
  /** Both actions off (no human credential, or a request whose files changed). */
  locked?: boolean;
}) {
  const { t, locale } = useI18n();
  const { capabilityLabel, source } = usePresent();
  const [trusted, setTrusted] = useState(false);
  const uid = useId();
  const p = fetched.preview;
  const key = scriptKey(fetched.fetchId, p.digest);
  // Decisions are the store's, keyed by this fetch and this digest: they are never reused for another fetch.
  const decisions = usePluginsStore((s) => (s.scripts.key === key ? s.scripts.decisions : NO_DECISIONS));
  const decide = usePluginsStore.getState().decideScript;
  const pending = p.scripts.some((name) => decisions[name] === undefined);
  const declined = p.scripts.some((name) => decisions[name] === "decline");
  const limits = (list: string[]) => (list.length ? list.map(capabilityLabel).join(", ") : "–");
  return (
    <div className="flex flex-col gap-3">
      <h3 className="t-heading text-ink">{heading ?? t("plugins.preview.title")}</h3>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-body">
        <dt className="text-ink-mute">{t("plugins.preview.name")}</dt>
        <dd className="font-mono text-code text-ink">
          {p.name} {p.version}
        </dd>
        <dt className="text-ink-mute">{t("plugins.detail.source")}</dt>
        <dd className="min-w-0 break-all font-mono text-code text-ink">{source(fetched.source)}</dd>
        <dt className="text-ink-mute">{t("plugins.preview.runtime")}</dt>
        <dd className="text-ink">{p.runtime === "in-process" ? t("plugins.runtime.in-process") : t("plugins.runtime.isolated")}</dd>
      </dl>
      <section aria-labelledby={`${uid}-caps`} className="flex flex-col gap-1">
        <h4 id={`${uid}-caps`} className="text-body font-medium text-ink">
          {t("plugins.preview.capabilities")}
        </h4>
        <CapabilityEffects runtime={p.runtime} capabilities={p.capabilities} confirmed={trusted} />
        <p className="text-meta text-ink-mute">{t("plugins.preview.limits", { enforced: limits(p.isolation.enforced), not: limits(p.isolation.notEnforced) })}</p>
      </section>
      {p.scripts.length > 0 && (
        <section aria-labelledby={`${uid}-scripts`} className="flex flex-col gap-2">
          <h4 id={`${uid}-scripts`} className="text-body font-medium text-ink">
            {t("plugins.scripts.title")}
          </h4>
          <p className="text-body text-ink-dim">{t("plugins.scripts.help")}</p>
          <ul className="flex flex-col gap-2">
            {p.scripts.map((name) => (
              <li key={name} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-control border border-line-soft bg-sub-100 px-3 py-2">
                <span className="min-w-0 break-all font-mono text-code text-ink">{name}</span>
                <span className="flex-1" />
                <div role="radiogroup" aria-label={t("plugins.scripts.group", { script: name })} className="flex flex-wrap gap-x-4 gap-y-1">
                  {(["accept", "decline"] as const).map((choice) => (
                    <label key={choice} className="flex min-h-control-md items-center gap-2 text-body text-ink pointer-coarse:min-h-control-touch">
                      <input
                        type="radio"
                        name={`${uid}-${name}`}
                        checked={decisions[name] === choice}
                        disabled={installing || locked}
                        onChange={() => decide(fetched.fetchId, p.digest, name, choice)}
                        className="h-4 w-4 flex-none accent-(--signal)"
                      />
                      {choice === "accept" ? t("plugins.scripts.accept") : t("plugins.scripts.decline")}
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {pending && <p className="text-meta text-ink-mute">{t("plugins.scripts.pending")}</p>}
        </section>
      )}
      {p.unmetDependencies.length > 0 && <Notice tone="warn">{t("plugins.preview.unmet", { list: p.unmetDependencies.join(", ") })}</Notice>}
      <section aria-labelledby={`${uid}-warning`} className="flex flex-col gap-1 rounded-control border border-warn p-3">
        <h4 id={`${uid}-warning`} className="text-body font-medium text-warn-text">
          {t("plugins.preview.hostWarning")}
        </h4>
        <p className="text-body text-ink-dim">{p.warning[locale] ?? p.warning.en}</p>
      </section>
      <Checkbox checked={trusted} onChange={setTrusted} disabled={installing}>
        {t("plugins.confirm")}
      </Checkbox>
      {error && <Notice tone="fault" title={t("plugins.install.failed")}>{error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button onClick={declined ? onDecline : onBack} disabled={installing || locked}>
          {declined ? (declineLabel ?? t("plugins.scripts.decline")) : (backLabel ?? t("plugins.back"))}
        </Button>
        <Button variant="primary" disabled={!trusted || locked || pending || declined} loading={installing} onClick={onInstall}>
          {confirmLabel ?? t("plugins.install")}
        </Button>
      </div>
    </div>
  );
}
