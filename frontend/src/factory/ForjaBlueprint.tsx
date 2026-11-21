"use client";
import { useState } from "react";
import { Button, EmptyState, Input, Notice, Segmented } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import type { MessageKey } from "@/i18n/translate";
import { forjaApi } from "./forjaApi";
import { useExplain } from "./useForja";

type Pane = "blueprint" | "fire" | "nilo";
const RECIPES = ["issue-pr", "triage", "review", "incident", "monorepo"] as const;

/** Edit the blueprint as a new trial, ask whether an automation would fire, or let Nilo draft a workflow. */
export function ForjaBlueprint() {
  const { t } = useI18n();
  const explain = useExplain();
  const [pane, setPane] = useState<Pane>("blueprint");
  const [factory, setFactory] = useState("");
  const [when, setWhen] = useState("has label docs");
  const [message, setMessage] = useState<string | null>(null);
  const [labels, setLabels] = useState("bug");
  const [payload, setPayload] = useState("docs");
  const [failed, setFailed] = useState<string[] | null>(null);
  const [recipe, setRecipe] = useState<(typeof RECIPES)[number]>("issue-pr");
  const [name, setName] = useState("payments");
  const [request, setRequest] = useState("");
  const [built, setBuilt] = useState<string | null>(null);

  const run = async (work: () => Promise<string | undefined>) => {
    try {
      setMessage((await work()) ?? null);
    } catch (error) {
      setMessage(explain(error));
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <Segmented
        label={t("forja.blueprint.panes")}
        value={pane}
        onChange={setPane}
        options={[
          { value: "blueprint", label: t("forja.nav.blueprint") },
          { value: "fire", label: t("forja.blueprint.fire") },
          { value: "nilo", label: t("forja.blueprint.nilo") },
        ]}
      />
      {message && <Notice tone="warn">{message}</Notice>}
      {pane === "blueprint" && (
        <div className="flex flex-col gap-3">
          <p className="text-body text-ink-dim">{t("forja.blueprint.lead")}</p>
          <ol className="flex flex-col gap-2">
            {["intake", "spec", "implement", "review", "merge"].map((stage) => (
              <li key={stage}><Button size="sm" variant="secondary">{t(`forja.column.${stage}` as MessageKey)}</Button></li>
            ))}
          </ol>
          <Input label={t("forja.blueprint.factory")} value={factory} onChange={(event) => setFactory(event.target.value)} />
          <Input label={t("forja.blueprint.when")} value={when} onChange={(event) => setWhen(event.target.value)} />
          <Button
            size="sm"
            variant="primary"
            disabled={!factory || !when.trim()}
            onClick={() => void run(async () => {
              const saved = await forjaApi.saveBlueprint({
                factory_id: factory,
                blueprint: { entry: [{ when, to: "implement" }, { to: "intake" }] },
              });
              return saved.status === "rejected" ? t("forja.blueprint.rejected") : t("forja.blueprint.saved");
            })}
          >
            {t("forja.blueprint.save")}
          </Button>
        </div>
      )}
      {pane === "fire" && (
        <div className="flex flex-col gap-3">
          <Input label={t("forja.blueprint.filter")} value={labels} onChange={(event) => setLabels(event.target.value)} />
          <Input label={t("forja.blueprint.payload")} value={payload} onChange={(event) => setPayload(event.target.value)} />
          <Button size="sm" onClick={() => void run(async () => {
            const result = await forjaApi.wouldFire({
              provider: "github", event: "issues", filter: { labels: labels.split(",").map((part) => part.trim()).filter(Boolean) },
              fields: { labels: payload.split(",").map((part) => part.trim()).filter(Boolean) },
            });
            setFailed(result.fires ? [] : result.failed);
            return undefined;
          })}>{t("forja.blueprint.fire")}</Button>
          {failed && (failed.length === 0 ? <EmptyState title={t("forja.blueprint.would")} /> : (
            <ul>{failed.map((name) => <li key={name} className="text-body">{t((["labels", "stage", "event", "payload"].includes(name) ? `forja.blueprint.miss.${name}` : "forja.blueprint.miss.other") as MessageKey)}</li>)}</ul>
          ))}
        </div>
      )}
      {pane === "nilo" && (
        <div className="flex flex-col gap-3">
          <Segmented
            label={t("forja.blueprint.recipes")}
            value={recipe}
            onChange={setRecipe}
            options={RECIPES.map((value) => ({ value, label: t(`forja.blueprint.recipe.${value}` as MessageKey) }))}
          />
          <Input label={t("forja.blueprint.name")} value={name} onChange={(event) => setName(event.target.value)} />
          <Input label={t("forja.blueprint.request")} value={request} onChange={(event) => setRequest(event.target.value)} />
          <Button size="sm" variant="primary" disabled={!name.trim()} onClick={() => void run(async () => {
            const result = await forjaApi.niloWorkflow({ recipe, name, request });
            setBuilt(result.ok ? t("forja.blueprint.valid") : t("forja.blueprint.invalid"));
            return undefined;
          })}>{t("forja.blueprint.nilo")}</Button>
          {built && <p role="status" className="text-body">{built}</p>}
        </div>
      )}
    </div>
  );
}
