"use client";

import { useState } from "react";
import { Button, EmptyState, Input, ListRow, Notice } from "@/components/ui";
import { useT } from "@/i18n/store";
import { usePluginsStore } from "@/store/pluginsStore";
import { sourceText } from "./text";

/** An index names packages. The trust warning stays on screen whether or not the index says it was reviewed. */
export function DiscoverTab({ onInspect }: { onInspect: () => void }) {
  const t = useT();
  const [url, setUrl] = useState("");
  const market = usePluginsStore((s) => s.market);
  const loadMarket = usePluginsStore((s) => s.loadMarket);
  const inspect = usePluginsStore((s) => s.inspect);
  const phase = usePluginsStore((s) => s.phase);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Notice tone="warn" title={t("plugins.discover.trustTitle")}>{t("plugins.discover.trustBody")}</Notice>
      <form
        className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void loadMarket(url.trim());
        }}
      >
        <Input className="min-w-0 flex-1" label={t("plugins.discover.url")} value={url} onChange={(e) => setUrl(e.target.value)} mono autoComplete="off" />
        <Button type="submit" variant="primary" disabled={!url.trim()}>{t("plugins.discover.load")}</Button>
      </form>
      {market.length === 0 ? (
        <EmptyState title={t("plugins.discover.emptyTitle")}>{t("plugins.discover.emptyBody")}</EmptyState>
      ) : (
        <ul className="flex min-w-0 flex-col gap-2">
          {market.map((entry) => (
            <li key={`${entry.name}@${entry.version}`} className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">
                <ListRow title={entry.name} meta={entry.version} description={entry.description || sourceText(t, entry.source)} />
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={phase === "downloading"}
                onClick={() => {
                  void inspect(entry.source);
                  onInspect();
                }}
              >
                {t("plugins.discover.add")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
