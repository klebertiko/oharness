"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { useT } from "@/i18n/store";
import { INTENTS, pickByIntent, rememberChoice, type ChoiceModel, type Effort, type ModelChoice } from "./modelChoice";

/** One picker: intent or every model, effort when the model has it, and the last five combinations. */
export function ModelDirectory({
  models,
  value,
  recent,
  onChange,
  onConnect,
}: {
  models: ChoiceModel[];
  value: ModelChoice | null;
  recent: ModelChoice[];
  onChange: (choice: ModelChoice, recent: ModelChoice[]) => void;
  onConnect: (connectionId: string) => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<"intent" | "all">("intent");
  const [query, setQuery] = useState("");
  const selected = models.find((model) => value && model.id === value.model && model.connectionId === value.connectionId);
  const choose = (model: ChoiceModel, effort: Effort | null) => {
    if (!model.available) return;
    const next = { connectionId: model.connectionId, model: model.id, effort: model.efforts?.length ? effort : null };
    onChange(next, rememberChoice(recent, next));
  };

  return (
    <div>
      <div role="tablist" aria-label={t("providers.models.picker")} className="flex gap-2">
        <Button size="sm" role="tab" aria-selected={tab === "intent"} onClick={() => setTab("intent")}>{t("providers.models.intent")}</Button>
        <Button size="sm" role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>{t("providers.models.all")}</Button>
      </div>
      {tab === "intent" ? (
        <ul className="mt-2 space-y-1">
          {INTENTS.map((intent) => {
            const pick = pickByIntent(models, intent);
            return (
              <li key={intent}>
                <Button size="sm" disabled={!pick} onClick={() => pick && choose(pick, null)}>{t(`providers.models.${intent}`)}</Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <ModelList models={models} query={query} onQuery={setQuery} onChoose={(model) => choose(model, value?.effort ?? model.efforts?.[0] ?? null)} onConnect={onConnect} />
      )}
      {selected?.efforts && selected.efforts.length > 0 && (
        <div className="mt-2 flex gap-2" role="group" aria-label={t("providers.models.effort")}>
          {selected.efforts.map((effort) => (
            <Button key={effort} size="sm" aria-pressed={value?.effort === effort} onClick={() => choose(selected, effort)}>
              {t(`providers.models.effort.${effort}`)}
            </Button>
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <div className="mt-2">
          <p className="t-body text-ink-mute">{t("providers.models.recent")}</p>
          <ul className="mt-1 space-y-1">
            {recent.map((item) => (
              <li key={`${item.connectionId}-${item.model}-${item.effort ?? ""}`}>
                <Button size="sm" onClick={() => onChange(item, rememberChoice(recent, item))}>
                  {item.model}{item.effort ? ` · ${t(`providers.models.effort.${item.effort}`)}` : ""}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ModelList({
  models,
  query,
  onQuery,
  onChoose,
  onConnect,
}: {
  models: ChoiceModel[];
  query: string;
  onQuery: (value: string) => void;
  onChoose: (model: ChoiceModel) => void;
  onConnect: (connectionId: string) => void;
}) {
  const t = useT();
  const needle = query.trim().toLowerCase();
  const shown = models.filter((model) => !needle || model.id.toLowerCase().includes(needle) || model.connectionLabel.toLowerCase().includes(needle));
  const groups = new Map<string, ChoiceModel[]>();
  for (const model of shown) {
    const list = groups.get(model.connectionLabel) ?? [];
    list.push(model);
    groups.set(model.connectionLabel, list);
  }
  return (
    <div className="mt-2">
      <Input compact aria-label={t("providers.models.search")} value={query} onChange={(event) => onQuery(event.target.value)} />
      {[...groups.entries()].map(([label, list]) => (
        <section key={label} className="mt-2" aria-label={label}>
          <h3 className="t-body font-medium text-ink">{label}</h3>
          <ul>
            {list.map((model) => (
              <li key={`${model.connectionId}-${model.id}`} className="flex items-center gap-2">
                <Button size="sm" disabled={!model.available} onClick={() => onChoose(model)}>{model.id}</Button>
                {!model.available && (
                  <>
                    <span className="t-body text-ink-mute">{model.reason}</span>
                    <Button size="sm" onClick={() => onConnect(model.connectionId)}>{t("providers.models.connect")}</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
