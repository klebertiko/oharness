"use client";
import { useState } from "react";
import { Badge, Button, Input, Notice, Panel } from "@/components/ui";
import { useT } from "@/i18n/store";
import { requiresModel } from "./catalog";
import { filterModelGroups } from "./modelSearch";
import { ModelPicker, modelDetail, modelSourceNote } from "./ModelPicker";
import { MODEL_PICKER_ATTR } from "./useConnectionActions";
import { modelNotPulled } from "./modelPull";
import { Row, Rows, WithCode } from "./rows";
import { specOf, useProviderStore, type Connection } from "./providerStore";

/** The command shown when a local Ollama answered with nothing pulled. */
const EXAMPLE_PULL = "ollama pull llama3.2";

/**
 * The one model setting a run reads: the connection's `defaultModel`
 * (backend/providers/resolution.py; a node's own model wins). A searchable list
 * with the default marked and a one-click "Use", capped the way the chat combo
 * caps it (ADR 0015) so a router with hundreds of ids never renders them all.
 */
export function ModelsPanel({ c }: { c: Connection }) {
  const t = useT();
  const spec = specOf(c);
  const setDefaultModel = useProviderStore((s) => s.setDefaultModel);
  const [query, setQuery] = useState("");
  const [save, setSave] = useState<{ state: "saving" | "saved" | "failed"; model: string } | null>(null);
  const required = requiresModel(spec);
  const notPulled = modelNotPulled(c);
  const ids = c.models.map((m) => m.id);
  const group = filterModelGroups([{ connectionId: c.id, label: c.label, models: ids }], query)[0];
  const byId = new Map(c.models.map((m) => [m.id, m]));

  const choose = async (model: string) => {
    setSave({ state: "saving", model });
    setSave({ state: (await setDefaultModel(c.id, model)) ? "saved" : "failed", model });
  };

  return (
    <Panel title={t("models.title")} titleId="oh-models" level={3} meta={required && !c.defaultModel ? t("models.none") : t("models.count", { n: ids.length })}>
      <Rows label={t("models.title")}>
        <Row label={t("models.default")}>
          <div {...{ [MODEL_PICKER_ATTR]: "" }} className="max-w-[26rem]">
            <ModelPicker
              connection={c}
              value={c.defaultModel}
              onChange={(m) => void choose(m)}
              label={t("models.default")}
              inheritLabel={required ? undefined : t("models.cliDefault")}
              inheritDetail={required ? undefined : t("models.cliDefault.detail")}
              triggerClassName="t-body h-control-md w-full justify-between rounded-control border border-line-strong bg-sub-100 px-2 text-left text-ink hover:bg-sub-200 pointer-coarse:h-control-touch"
            />
          </div>
          <p className="t-body mt-1.5 max-w-[62ch] text-ink-mute">{required ? t("models.required") : t("models.optional")}</p>
          <div className="mt-1 min-h-4 text-body" aria-live="polite">
            {save?.state === "saving" && <p className="text-ink-dim">{t("models.saving")}</p>}
            {save?.state === "saved" && <p className="text-ink-dim">{save.model ? t("models.saved", { model: save.model }) : t("models.saved.cli")}</p>}
            {save?.state === "failed" && (
              <p role="alert" className="text-fault-text">
                {t("models.failed")}
              </p>
            )}
          </div>
        </Row>
      </Rows>

      {notPulled && (
        <div className="px-3 pb-3">
          <Notice tone="warn" title={t("models.notPulled.title", { model: notPulled })}>
            {t("models.notPulled.body")}
          </Notice>
        </div>
      )}

      <div className="border-t border-line-soft px-3 py-3">
        <p className="t-body mb-2 text-ink-mute">{modelSourceNote(c)}</p>
        {ids.length === 0 ? (
          <p className="t-body max-w-[62ch] text-ink-mute">
            {c.provider === "ollama" && c.residence === "local" && c.modelsFromEndpoint ? <WithCode text={t("models.emptyLocal", { cmd: EXAMPLE_PULL })} /> : t("models.empty")}
          </p>
        ) : (
          <>
            {ids.length > 8 && (
              <Input
                compact
                type="search"
                aria-label={t("models.filter")}
                placeholder={t("models.filter")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="mb-2 max-w-[26rem]"
              />
            )}
            {group && group.items.length > 0 ? (
              <ul aria-label={t("models.list", { name: c.label })} className="overflow-hidden rounded-control border border-line-soft">
                {group.items.map((id, i) => {
                  const isDefault = id === c.defaultModel;
                  const detail = byId.get(id) ? modelDetail(byId.get(id) as never) : "";
                  return (
                    <li key={id} className={`flex items-center gap-3 px-3 py-1.5 ${i ? "border-t border-line-soft" : ""} ${isDefault ? "bg-sub-200" : ""}`}>
                      <span className="min-w-0 flex-1">
                        <span className="t-meta block truncate text-ink">{id}</span>
                        {detail && <span className="t-meta block truncate text-ink-mute">{detail}</span>}
                      </span>
                      {isDefault ? (
                        <Badge tone="signal">{t("models.default.badge")}</Badge>
                      ) : (
                        <Button size="sm" variant="ghost" aria-label={t("models.use.aria", { model: id })} onClick={() => void choose(id)}>
                          {t("models.use")}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="t-body text-ink-mute">{t("models.noMatch", { query })}</p>
            )}
            {group && group.hidden > 0 && <p className="t-body mt-2 text-ink-mute">{t("models.more", { n: group.hidden })}</p>}
          </>
        )}
      </div>
    </Panel>
  );
}
