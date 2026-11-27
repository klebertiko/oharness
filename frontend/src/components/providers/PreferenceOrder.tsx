"use client";

import { useEffect, useState } from "react";
import { Button, Input, Panel } from "@/components/ui";
import { useT } from "@/i18n/store";
import { accountOrder, hasSavedOrder, movePreference } from "./preference";
import { useProviderStore } from "./providerStore";

/** Several accounts, each with its own label, in the order failover will try them. */
export function PreferenceOrder({
  ids,
  labels,
  onChange,
  onRename,
}: {
  ids: string[];
  labels: Record<string, string>;
  onChange: (ids: string[]) => void;
  onRename: (id: string, label: string) => void;
}) {
  const t = useT();
  const [drag, setDrag] = useState<number | null>(null);
  return (
    <ol aria-label={t("providers.preference.title")} className="space-y-1">
      {ids.map((id, index) => (
        <li
          key={id}
          draggable
          onDragStart={() => setDrag(index)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            if (drag == null) return;
            onChange(movePreference(ids, drag, index));
            setDrag(null);
          }}
          className="flex items-center gap-2 rounded-control border border-line-soft px-2 py-1"
        >
          <span className="t-body text-ink-mute" aria-hidden>{index + 1}</span>
          <LabelField id={id} label={labels[id] ?? id} onRename={onRename} />
          <Button size="sm" aria-label={t("providers.preference.up", { name: labels[id] ?? id })} disabled={index === 0} onClick={() => onChange(movePreference(ids, index, index - 1))}>
            {t("providers.preference.upShort")}
          </Button>
          <Button size="sm" aria-label={t("providers.preference.down", { name: labels[id] ?? id })} disabled={index === ids.length - 1} onClick={() => onChange(movePreference(ids, index, index + 1))}>
            {t("providers.preference.downShort")}
          </Button>
        </li>
      ))}
    </ol>
  );
}

/** The name is saved once, when the field is left or Enter is pressed — not on every keystroke. */
function LabelField({ id, label, onRename }: { id: string; label: string; onRename: (id: string, label: string) => void }) {
  const t = useT();
  const [draft, setDraft] = useState(label);
  useEffect(() => setDraft(label), [label]);
  const commit = () => {
    const value = draft.trim();
    if (!value) {
      setDraft(label);
      return;
    }
    if (value !== label) onRename(id, value);
  };
  return (
    <Input
      compact
      className="min-w-0 flex-1"
      aria-label={t("providers.preference.label", { name: label })}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

/** The Providers screen's account order: shown only when two or more accounts can answer. */
export function AccountOrderPanel() {
  const t = useT();
  const connections = useProviderStore((s) => s.connections);
  const savePreference = useProviderStore((s) => s.savePreference);
  const renameConnection = useProviderStore((s) => s.renameConnection);
  const accounts = accountOrder(connections);
  if (accounts.length < 2) return null;
  const saved = hasSavedOrder(accounts);
  return (
    <Panel title={t("providers.preference.title")} titleId="oh-preference" className="m-3 mb-0 flex-none">
      <div className="space-y-2 p-3">
        <p className="t-body text-ink-dim">{t(saved ? "providers.preference.saved" : "providers.preference.unsaved")}</p>
        <PreferenceOrder
          ids={accounts.map((c) => c.id)}
          labels={Object.fromEntries(accounts.map((c) => [c.id, c.label]))}
          onChange={(ids) => void savePreference(ids)}
          onRename={(id, label) => void renameConnection(id, label)}
        />
      </div>
    </Panel>
  );
}
