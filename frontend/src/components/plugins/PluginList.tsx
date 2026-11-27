"use client";
import { Badge, ListRow, Switch } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import { STATE_BADGE, STATE_KEY, usePresent } from "./present";
import type { PluginView } from "./types";

/** The installed plugins: name, version, source, state, capabilities, and the switch. A row opens the detail panel. */
export function PluginList({
  plugins,
  selectedId,
  busy,
  canChange,
  onSelect,
  onToggle,
}: {
  plugins: PluginView[];
  selectedId: string | null;
  busy: Record<string, boolean>;
  canChange: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string, on: boolean) => void;
}) {
  const { t } = useI18n();
  const { capabilityLabel, source } = usePresent();
  return (
    <ul aria-label={t("plugins.list.aria")} className="flex flex-col divide-y divide-line-soft rounded-panel border border-line-soft bg-sub-100">
      {plugins.map((p) => (
        <li key={p.id} className="flex flex-col gap-1 py-1 pr-2">
          <div className="flex items-center gap-2">
            <ListRow
              className="flex-1"
              title={p.name}
              meta={`v${p.version} · ${source(p.source)}`}
              selected={selectedId === p.id}
              aria-label={t("plugins.open", { name: p.name })}
              onClick={() => onSelect(p.id)}
            />
            <Badge tone={STATE_BADGE[p.state]}>{t(STATE_KEY[p.state])}</Badge>
            <Switch checked={p.enabled} label={t("plugins.toggle", { name: p.name })} disabled={!canChange || busy[p.id]} aria-busy={busy[p.id] || undefined} onCheckedChange={(on) => onToggle(p.id, on)} />
          </div>
          {(p.capabilities.length > 0 || p.message || p.state === "changed") && (
            <div className="flex flex-col gap-1 px-3 pb-1">
              {p.capabilities.length > 0 && (
                <ul className="flex flex-wrap gap-1">
                  {p.capabilities.map((c) => (
                    <li key={c}>
                      <Badge>{capabilityLabel(c)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              {p.state === "changed" ? <p className="text-meta text-warn-text">{t("plugins.state.changedHelp")}</p> : p.message && <p className="text-meta text-ink-mute">{p.message}</p>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
