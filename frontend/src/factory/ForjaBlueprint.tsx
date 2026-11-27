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
  const [message, setMessage] = useState<string | null>(null);
  const [labels, setLabels] = useState("bug");
  const [payload, setPayload] = useState("docs");
  const [failed, setFailed] = useState<string[] | null>(null);
  const [recipe, setRecipe] = useState<(typeof RECIPES)[number]>("issue-pr");
  const [name, setName] = useState("payments");
  const [request, setRequest] = useState("");
  const [built, setBuilt] = useState<string | null>(null);
  const [nilo, setNilo] = useState<{ files: Record<string, string>; errors: string[] } | null>(null);

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
      {pane === "blueprint" && <BlueprintEditor />}
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
            setNilo({ files: result.files ?? {}, errors: result.errors.map((error) => error.message) });
            return undefined;
          })}>{t("forja.blueprint.nilo")}</Button>
          {built && <p role="status" className="text-body">{built}</p>}
          {nilo && nilo.errors.length > 0 && (
            <ul className="text-body">
              {nilo.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
          {nilo &&
            Object.entries(nilo.files).map(([file, text]) => (
              <details key={file} className="rounded-control border border-line-soft p-2">
                <summary className="text-body">{file}</summary>
                <pre className="overflow-x-auto whitespace-pre-wrap text-body">{text}</pre>
              </details>
            ))}
        </div>
      )}
    </div>
  );
}

type Rule = Record<string, unknown>;
type Kind = (typeof KINDS)[number];
type Blueprint = Record<string, unknown> & { entry?: Rule[]; routes?: Rule[]; gates?: Rule[] };
type Removed = { kind: Kind; rule: Rule };
type Shown = { tone: "info" | "warn"; text: string; reasons?: string[] };
const KINDS = ["entry", "routes", "gates"] as const;
const STAGES = ["intake", "triage", "spec", "implement", "review", "verify", "handoff", "monitor"] as const;
const ENTRY_TARGETS = ["intake", "triage", "spec", "implement", "review"] as const;
const FACTORY_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const words = (text: string) => text.split(",").map((part) => part.trim()).filter(Boolean);

/** Edit the active blueprint: load it, change it here, see what a save would remove, and save it as a trial. */
function BlueprintEditor() {
  const { t } = useI18n();
  const explain = useExplain();
  const [factory, setFactory] = useState("");
  const [loaded, setLoaded] = useState<{ factory: string; hash: string; trial: boolean } | null>(null);
  const [draft, setDraft] = useState<Blueprint>({});
  const [when, setWhen] = useState("");
  const [to, setTo] = useState<(typeof ENTRY_TARGETS)[number]>("intake");
  const [pending, setPending] = useState<Removed[] | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [example, setExample] = useState("");
  const [path, setPath] = useState<string | null>(null);
  const valid = FACTORY_ID.test(factory);

  const stage = (name: unknown) => {
    const value = String(name ?? "");
    if (value === "end") return t("forja.blueprint.end");
    return (STAGES as readonly string[]).includes(value) ? t(`forja.stage.${value}` as MessageKey) : value;
  };
  const kindName = (kind: Kind) => t(`forja.blueprint.kind.${kind}` as MessageKey);
  const describe = (kind: Kind, rule: Rule) => {
    const condition = String(rule.when || t("forja.blueprint.always"));
    if (kind === "entry") return `${condition} → ${stage(rule.to)}`;
    if (kind === "routes") return [`${stage(rule.from)} → ${stage(rule.to)}`, condition, rule.reason].filter(Boolean).join(" · ");
    return [stage(rule.stage), rule.prompt, condition].filter(Boolean).join(" · ");
  };
  const attempt = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      setShown({ tone: "warn", text: explain(error) });
    }
  };
  // The server's view replaces the local one: after a save the hash, the blueprint and the trial come from there.
  const fetchFrom = async (name: string) => {
    const got = await forjaApi.readBlueprint(name);
    setLoaded({ factory: name, hash: got.hash, trial: Boolean(got.trial) });
    setDraft((got.blueprint ?? {}) as Blueprint);
    setPending(null);
    setPath(null);
  };
  const load = () =>
    attempt(async () => {
      setShown(null);
      await fetchFrom(factory);
    });
  const save = (confirmed: boolean) =>
    attempt(async () => {
      if (!loaded) return;
      const body = { factory_id: loaded.factory, base_hash: loaded.hash, blueprint: draft };
      if (!confirmed) {
        const preview = await forjaApi.saveBlueprint({ ...body, preview: true });
        if (preview.reasons?.length) {
          setShown({ tone: "warn", text: t("forja.blueprint.rejected"), reasons: preview.reasons.map((reason) => reason.message) });
          return;
        }
        if (preview.removed?.length) {
          setPending(preview.removed);
          return;
        }
      }
      setPending(null);
      const saved = await forjaApi.saveBlueprint(body);
      setShown(
        saved.status === "rejected"
          ? { tone: "warn", text: t("forja.blueprint.rejected"), reasons: saved.reasons?.map((reason) => reason.message) }
          : { tone: "info", text: t("forja.blueprint.saved") },
      );
      if (saved.status !== "rejected") await fetchFrom(loaded.factory);
    });
  const remove = (kind: Kind, index: number) =>
    setDraft((current) => ({ ...current, [kind]: (current[kind] ?? []).filter((_, at) => at !== index) }));
  const simulate = () =>
    attempt(async () => {
      if (!loaded) return;
      const result = await forjaApi.simulateBlueprint({ factory_id: loaded.factory, blueprint: draft, facts: { labels: words(example) } });
      setPath(result.path.map((step) => stage(step.stage)).join(" → "));
    });
  const rules = KINDS.flatMap((kind) => (draft[kind] ?? []).map((rule, index) => ({ kind, rule, index })));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-ink-dim">{t("forja.blueprint.lead")}</p>
      <Input
        label={t("forja.blueprint.factory")}
        value={factory}
        error={factory === "" || valid ? undefined : t("forja.blueprint.factoryInvalid")}
        onChange={(event) => setFactory(event.target.value)}
      />
      <Button size="sm" disabled={!valid} onClick={() => void load()}>
        {t("forja.blueprint.load")}
      </Button>
      {shown && (
        <Notice tone={shown.tone}>
          {shown.text}
          {shown.reasons?.length ? (
            <ul>
              {shown.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      )}
      {loaded && (
        <>
          {rules.length === 0 ? (
            <EmptyState title={t("forja.blueprint.empty")} />
          ) : (
            <ul className="flex flex-col gap-2">
              {rules.map(({ kind, rule, index }) => (
                <li key={`${kind}-${index}`} className="flex items-center justify-between gap-2 text-body">
                  <span>
                    <span className="text-ink-dim">{kindName(kind)}: </span>
                    {describe(kind, rule)}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`${t("forja.blueprint.remove", { kind: kindName(kind) })}: ${describe(kind, rule)}`}
                    onClick={() => remove(kind, index)}
                  >
                    {t("forja.blueprint.removeShort")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Input label={t("forja.blueprint.when")} value={when} onChange={(event) => setWhen(event.target.value)} />
          <Segmented label={t("forja.blueprint.to")} value={to} onChange={setTo} options={ENTRY_TARGETS.map((value) => ({ value, label: stage(value) }))} />
          <Button
            size="sm"
            disabled={!when.trim()}
            onClick={() => {
              setDraft((current) => ({ ...current, entry: [{ when: when.trim(), to }, ...(current.entry ?? [])] }));
              setWhen("");
            }}
          >
            {t("forja.blueprint.add")}
          </Button>
          {loaded.trial ? (
            <Notice tone="info">{t("forja.blueprint.trialRunning")}</Notice>
          ) : pending ? (
            <Notice tone="warn" title={t("forja.blueprint.removes")}>
              <ul>
                {pending.map((item, index) => (
                  <li key={`${item.kind}-${index}`}>
                    {kindName(item.kind)}: {describe(item.kind, item.rule)}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="primary" onClick={() => void save(true)}>
                  {t("forja.blueprint.confirm")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setPending(null)}>
                  {t("forja.blueprint.keepEditing")}
                </Button>
              </div>
            </Notice>
          ) : (
            <Button size="sm" variant="primary" onClick={() => void save(false)}>
              {t("forja.blueprint.save")}
            </Button>
          )}
          <Input label={t("forja.blueprint.example")} value={example} onChange={(event) => setExample(event.target.value)} />
          <Button size="sm" onClick={() => void simulate()}>
            {t("forja.blueprint.simulate")}
          </Button>
          {path && (
            <p role="status" className="text-body">
              {t("forja.blueprint.path")}: {path}
            </p>
          )}
        </>
      )}
    </div>
  );
}
