"use client";
import { Plus, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, Notice, Segmented, SkeletonRows } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import { usePluginsStore } from "@/store/pluginsStore";
import { AddPlugin } from "./AddPlugin";
import { CreatorCard } from "./CreatorCard";
import { DiscoverTab } from "./DiscoverTab";
import { HostHeader } from "./HostHeader";
import { NiloRequests } from "./NiloRequests";
import { PluginDetail } from "./PluginDetail";
import { PluginList } from "./PluginList";
import { hasHumanCredential } from "./pluginsApi";
import { usePresent } from "./present";
import type { FetchRequest } from "./types";

/**
 * The Cordis Plugins destination (ADR 0071): the host's state, the installed plugins with their state and capabilities, and the flow that
 * adds one. Changes need the person's credential; without it the screen says so and leaves them off.
 */
export function PluginsScreen() {
  const { t } = useI18n();
  const { explain } = usePresent();
  const { phase, status, plugins, refreshError, actionError, busy, selectedId } = usePluginsStore();
  const { load, loadNilo, toggle, select, clearActionError } = usePluginsStore.getState();
  const [adding, setAdding] = useState(false);
  const [prefill, setPrefill] = useState<FetchRequest | null>(null);
  const [view, setView] = useState<"installed" | "discover">("installed");
  const [refreshing, setRefreshing] = useState(false);
  const [canChange, setCanChange] = useState(false);

  useEffect(() => {
    setCanChange(hasHumanCredential());
    void load();
    void loadNilo();
  }, [load, loadNilo]);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), loadNilo()]);
    setRefreshing(false);
  };
  const selected = plugins.find((p) => p.id === selectedId) ?? null;
  const add = () => {
    setPrefill(null);
    setAdding(true);
  };
  // Inspect opens the add sheet and starts the fetch with the entry's source: the form is skipped, the review and its confirmation are not.
  const inspectFromIndex = (request: FetchRequest) => {
    setPrefill(request);
    setAdding(true);
    void usePluginsStore.getState().fetchPackage(request);
  };

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-3">
          <HostHeader status={status} canChange={canChange} onAdd={add} onRefresh={() => void refresh()} refreshing={refreshing} />
          <Notice tone="warn" title={t("plugins.safety.title")} className="items-start">
            {t("plugins.safety.body")}
          </Notice>
          {!canChange && (
            <p className="flex items-start gap-2 text-body text-ink-dim">
              <ShieldAlert size={14} aria-hidden className="mt-1 flex-none text-ink-mute" />
              {t("plugins.noCredential")}
            </p>
          )}
          {actionError && (
            <Notice tone="fault" action={<Button size="sm" variant="ghost" onClick={clearActionError}>{t("plugins.detail.close")}</Button>}>
              {explain(actionError)}
            </Notice>
          )}
          {refreshError && phase === "ready" && <Notice tone="warn" title={t("plugins.refreshFailed")}>{t("plugins.error.why", { reason: refreshError.message })}</Notice>}

          <Segmented
            label={t("plugins.view.label")}
            value={view}
            onChange={setView}
            options={[
              { value: "installed", label: t("plugins.view.installed") },
              { value: "discover", label: t("plugins.view.discover") },
            ]}
          />
          {view === "discover" && <DiscoverTab canChange={canChange} onInspect={inspectFromIndex} />}
          {view === "installed" && (
            <>
              <CreatorCard canChange={canChange} />
              <NiloRequests canChange={canChange} />
              {phase === "loading" && <SkeletonRows rows={3} label={t("plugins.loading")} />}
              {phase === "error" && (
                <ErrorState
                  title={t("plugins.error.title")}
                  reason={t("plugins.error.why", { reason: refreshError?.message ?? "" })}
                  diagnostic={`GET /cordis/plugins: ${refreshError?.message ?? ""}`}
                  onRetry={() => void refresh()}
                />
              )}
              {phase === "ready" && plugins.length === 0 && (
                <EmptyState
                  title={t("plugins.empty.title")}
                  action={
                    <Button variant="primary" icon={<Plus size={14} aria-hidden />} disabled={!canChange} onClick={add}>
                      {t("plugins.add")}
                    </Button>
                  }
                >
                  {t("plugins.empty.body")}
                </EmptyState>
              )}
              {phase === "ready" && plugins.length > 0 && (
                <PluginList plugins={plugins} selectedId={selectedId} busy={busy} canChange={canChange} onSelect={select} onToggle={(id, on) => void toggle(id, on)} />
              )}
              {selected && <PluginDetail plugin={selected} canChange={canChange} onClose={() => select(null)} />}
            </>
          )}
        </div>
      </div>
      <AddPlugin key={prefill ? JSON.stringify(prefill) : "blank"} open={adding} initial={prefill} onClose={() => setAdding(false)} />
    </div>
  );
}
