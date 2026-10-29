"use client";
import { ListRow, Notice, Skeleton, StatusMark } from "@/components/ui";
import { useT } from "@/i18n/store";
import { SpendCard } from "./SpendCard";
import type { Connection } from "./providerStore";
import { GROUP_LABEL, groupViews, type ConnectionView } from "./view";

function Row({ v, selected, onSelect }: { v: ConnectionView; selected: boolean; onSelect: () => void }) {
  const t = useT();
  const { connection: c, step } = v;
  return (
    <li>
      <ListRow
        title={c.label}
        leading={<StatusMark tone={v.tone} />}
        description={
          <>
            <span className={v.text}>{v.status}</span>
            {step && <span> · {step.hint}</span>}
          </>
        }
        trailing={<span className="t-body text-ink-mute">{t(c.residence === "local" ? "meta.local" : "meta.cloud")}</span>}
        selected={selected}
        onClick={onSelect}
        className="py-2"
      />
    </li>
  );
}

/** Every connection, grouped by what the person has to do: "Needs action" first (nearest to answering on top, the order the chat combo uses), then "Ready". Labels and health only; a credential never appears here (ADR 0001). */
export function ConnectionList({
  connections,
  selectedId,
  onSelect,
  offline,
  loading,
}: {
  connections: Connection[];
  selectedId: string;
  onSelect: (id: string) => void;
  offline: boolean;
  loading: boolean;
}) {
  const t = useT();
  const groups = groupViews(connections, offline);
  const ready = connections.filter((c) => groups.some((g) => g.group === "ready" && g.views.some((v) => v.connection.id === c.id))).length;
  const nothing = !loading && !offline && ready === 0;
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy={loading || undefined}>
      <header className="flex-none px-4 pb-2 pt-4">
        <h2 className="t-title text-ink">{t("list.title")}</h2>
        {!loading && !offline && <p className="t-body text-ink-mute">{t("list.summary", { ready, total: connections.length })}</p>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {nothing && (
          <Notice tone="info" title={t("list.empty.title")} className="mx-2 mb-2">
            {t("list.empty.body")}
          </Notice>
        )}
        {loading ? (
          <div role="status" aria-label={t("list.loading")} className="space-y-1 px-1">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.group} aria-labelledby={`oh-group-${g.group}`} className="mb-2">
              <h3 id={`oh-group-${g.group}`} className={g.group === "all" ? "sr-only" : "t-body px-2.5 py-1.5 font-medium text-ink-mute"}>
                {t(GROUP_LABEL[g.group])}
              </h3>
              <ul className="space-y-0.5">
                {g.views.map((v) => (
                  <Row key={v.connection.id} v={v} selected={v.connection.id === selectedId} onSelect={() => onSelect(v.connection.id)} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      <SpendCard />
    </div>
  );
}
