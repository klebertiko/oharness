"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { useT } from "@/i18n/store";
import { movePreference } from "./preference";

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
          <Input
            compact
            aria-label={t("providers.preference.label", { name: labels[id] ?? id })}
            value={labels[id] ?? id}
            onChange={(event) => onRename(id, event.target.value)}
          />
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
