"use client";
import { Check } from "lucide-react";
import { Button, Notice, Sheet } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import { usePluginsStore } from "@/store/pluginsStore";
import { AddForm } from "./AddForm";
import { usePresent } from "./present";
import { PreviewStep } from "./PreviewStep";

/** The add flow as one sheet: where from, then review and confirm, then installed. Closing it at any step drops what was downloaded for it. */
export function AddPlugin({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { explain } = usePresent();
  const add = usePluginsStore((s) => s.add);
  const fetchPackage = usePluginsStore((s) => s.fetchPackage);
  const install = usePluginsStore((s) => s.install);
  const resetAdd = usePluginsStore((s) => s.resetAdd);
  const toggle = usePluginsStore((s) => s.toggle);
  const busy = usePluginsStore((s) => (s.add.installed ? !!s.busy[s.add.installed.id] : false));

  const close = () => {
    resetAdd();
    onClose();
  };
  const installed = add.installed;
  return (
    <Sheet open={open} onOpenChange={(next) => !next && close()} title={t("plugins.add.title")} showClose className="w-[min(640px,calc(100vw-24px))]">
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {add.step === "form" && (
          <div className="flex flex-col gap-2">
            {add.error && (
              <Notice tone="fault" title={t("plugins.add.failed")}>
                {explain(add.error)}
              </Notice>
            )}
            <AddForm onSubmit={(request) => void fetchPackage(request)} onCancel={close} />
          </div>
        )}
        {add.step === "fetching" && (
          <div className="flex flex-col gap-3">
            <Notice tone="info">{t("plugins.add.fetching")}</Notice>
            <div className="flex justify-end">
              <Button onClick={resetAdd}>{t("plugins.add.cancel")}</Button>
            </div>
          </div>
        )}
        {(add.step === "preview" || add.step === "installing") && add.fetched && (
          <PreviewStep
            fetched={add.fetched}
            installing={add.step === "installing"}
            error={add.error ? explain(add.error) : null}
            onBack={resetAdd}
            onInstall={() => void install(true)}
          />
        )}
        {add.step === "done" && installed && (
          <div className="flex flex-col gap-3">
            <p className="t-heading flex items-center gap-2 text-ink">
              <Check size={16} aria-hidden />
              {t("plugins.done.title", { name: installed.name, version: installed.version })}
            </p>
            <p className="text-body text-ink-dim">{t("plugins.done.body")}</p>
            <div className="flex justify-end gap-2">
              {(!installed.enabled || installed.state === "disabled") && (
                <Button variant="primary" loading={busy} onClick={() => void toggle(installed.id, true)}>
                  {t("plugins.done.activate")}
                </Button>
              )}
              <Button onClick={close}>{t("plugins.done.close")}</Button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
