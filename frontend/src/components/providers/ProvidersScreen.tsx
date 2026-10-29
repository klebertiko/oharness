"use client";
import { useEffect, useState } from "react";
import { Button, Notice } from "@/components/ui";
import { useT } from "@/i18n/store";
import { ConnectionDetail, DetailSkeleton } from "./ConnectionDetail";
import { ConnectionList } from "./ConnectionList";
import { useProviderStore } from "./providerStore";
import { defaultConnectionId } from "./view";

/**
 * The Providers destination (ADR 0035): a Curated Library that owns the whole
 * stage. Wide, the list sits beside the connection; narrow, the list is the
 * screen and a connection opens over it with a Back button, so the list never
 * disappears behind a picker. Which pane shows follows the stage's width
 * (container query), not the window's. With nothing picked the detail shows the
 * connection nearest to answering, so a fresh install lands on its next step.
 */
export function ProvidersScreen() {
  const t = useT();
  const connections = useProviderStore((s) => s.connections);
  const selectedId = useProviderStore((s) => s.selectedId);
  const select = useProviderStore((s) => s.select);
  const loadState = useProviderStore((s) => s.loadState);
  const hydrate = useProviderStore((s) => s.hydrate);
  const offline = loadState === "offline";
  const loading = loadState === "loading";
  const opened = connections.find((c) => c.id === selectedId);
  // The default is chosen once the sidecar has answered and then held: a connection that becomes ready while the
  // person works on it must not swap the pane for another one.
  const [pinned, setPinned] = useState("");
  useEffect(() => {
    if (!pinned && (loadState === "ready" || loadState === "offline") && connections.length) setPinned(defaultConnectionId(connections));
  }, [pinned, loadState, connections]);
  const shown = opened ?? connections.find((c) => c.id === pinned) ?? connections.find((c) => c.id === defaultConnectionId(connections));

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <h1 className="sr-only">{t("screen.title")}</h1>
      {offline && (
        <Notice
          tone="fault"
          title={t("offline.title")}
          className="m-3 flex-none"
          action={
            <Button size="sm" onClick={() => void hydrate()}>
              {t("offline.retry")}
            </Button>
          }
        >
          {t("offline.body")}
        </Notice>
      )}
      <div className="grid min-h-0 flex-1 @2xl:grid-cols-[20rem_minmax(0,1fr)]">
        <aside aria-label={t("list.title")} className={`min-h-0 border-line-soft bg-sub-000 @2xl:border-r ${opened ? "@max-2xl:hidden" : ""}`}>
          <ConnectionList connections={connections} selectedId={shown?.id ?? ""} onSelect={select} offline={offline} loading={loading} />
        </aside>
        <section className={`min-h-0 ${opened ? "" : "hidden @2xl:block"}`}>
          {loading ? <DetailSkeleton /> : shown && <ConnectionDetail key={shown.id} c={shown} offline={offline} onBack={() => select("")} />}
        </section>
      </div>
    </div>
  );
}
