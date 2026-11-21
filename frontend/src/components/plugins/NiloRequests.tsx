"use client";
import { Bot } from "lucide-react";
import { useId } from "react";
import { Notice } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import { usePluginsStore } from "@/store/pluginsStore";
import { usePresent } from "./present";
import { PreviewStep } from "./PreviewStep";
import type { NiloRequest } from "./types";

/**
 * Install requests from Nilo (creator mode, ADR 0071). Nilo never installs: each request shows the same review as adding a plugin, and only
 * Approve here, with the person's credential, installs it with the digest of that review. Files changed after the request cannot be approved.
 */
export function NiloRequests({ canChange }: { canChange: boolean }) {
  const { t } = useI18n();
  const { explain } = usePresent();
  const titleId = useId();
  const requests = usePluginsStore((s) => s.requests);
  const busy = usePluginsStore((s) => s.busy);
  const requestError = usePluginsStore((s) => s.requestError);
  const { approve, reject } = usePluginsStore.getState();

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h2 id={titleId} className="t-heading flex items-center gap-2 text-ink">
        <Bot size={16} aria-hidden />
        {t("plugins.nilo.title")}
      </h2>
      {requestError && <Notice tone="fault" title={t("plugins.nilo.failed")}>{explain(requestError)}</Notice>}
      {requests.length === 0 ? (
        <p className="text-body text-ink-dim">{t("plugins.nilo.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((request) => (
            <li key={request.id} className="rounded-panel border border-line-soft bg-sub-100 p-3">
              <RequestCard request={request} canChange={canChange} busy={!!busy[request.id]} onApprove={() => void approve(request.id)} onReject={() => void reject(request.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RequestCard({ request, canChange, busy, onApprove, onReject }: { request: NiloRequest; canChange: boolean; busy: boolean; onApprove: () => void; onReject: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-meta text-ink-mute">{t("plugins.nilo.from", { folder: request.devName })}</p>
      <Notice tone="warn">{t("plugins.nilo.warn")}</Notice>
      {request.changed && <Notice tone="fault">{t("plugins.nilo.changed")}</Notice>}
      {request.replaces && <Notice tone="info">{t("plugins.nilo.replaces", { version: request.replaces.version })}</Notice>}
      <PreviewStep
        fetched={{ fetchId: request.id, source: { kind: "local", spec: `dev/${request.devName}` }, preview: request.preview }}
        heading={t("plugins.nilo.asks", { name: request.name, version: request.version })}
        installing={busy}
        error={null}
        onBack={onReject}
        onInstall={onApprove}
        locked={!canChange}
        confirmLabel={t("plugins.nilo.approve")}
        backLabel={t("plugins.nilo.reject")}
      />
    </div>
  );
}
