"use client";
import { useId, useState } from "react";
import { Button, Notice } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import { Checkbox } from "./Checkbox";
import { usePresent } from "./present";
import type { FetchResult } from "./types";

/**
 * What the person confirms: name, version, source, runtime, what each capability grants, the scripts that will not run and the host's own
 * warning in the current language. Install stays off until the box is ticked; the digest of exactly this warning and these files goes with it.
 */
export function PreviewStep({ fetched, installing, error, onBack, onInstall, confirmLabel, backLabel, heading, locked = false }: {
  fetched: FetchResult; installing: boolean; error: string | null; onBack: () => void; onInstall: () => void;
  /** A request from Nilo reuses this review with Approve/Reject and its own heading. */
  confirmLabel?: string; backLabel?: string; heading?: string;
  /** Both actions off (no human credential, or a request whose files changed). */
  locked?: boolean;
}) {
  const { t, locale } = useI18n();
  const { capabilityLabel, capabilityGrant, source } = usePresent();
  const [trusted, setTrusted] = useState(false);
  const uid = useId();
  const p = fetched.preview;
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
        {p.capabilities.length === 0 ? (
          <p className="text-body text-ink-dim">{t("plugins.capability.none")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-body text-ink-dim">
            {p.capabilities.map((c) => (
              <li key={c}>
                <span className="font-medium text-ink">{capabilityLabel(c)}.</span> {capabilityGrant(c)}
              </li>
            ))}
          </ul>
        )}
        <p className="text-meta text-ink-mute">{t("plugins.preview.limits", { enforced: limits(p.isolation.enforced), not: limits(p.isolation.notEnforced) })}</p>
      </section>
      {p.scripts.length > 0 && <Notice tone="info">{t("plugins.preview.scripts", { list: p.scripts.join(", ") })}</Notice>}
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
        <Button onClick={onBack} disabled={installing || locked}>
          {backLabel ?? t("plugins.back")}
        </Button>
        <Button variant="primary" disabled={!trusted || locked} loading={installing} onClick={onInstall}>
          {confirmLabel ?? t("plugins.install")}
        </Button>
      </div>
    </div>
  );
}
