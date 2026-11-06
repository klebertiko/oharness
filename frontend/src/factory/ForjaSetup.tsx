"use client";
import { useEffect, useState } from "react";
import { Button, Input, Notice, Panel } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import { forjaApi, type MemoryNote, type SecretRow, type Validation } from "./forjaApi";
import { OfflineNotice } from "./Offline";
import { useExplain, useLoad } from "./useForja";

const CANARY_PERCENT = 10;

/** How the Forja is set up: the definition versions (check, activate, trial, go back), the secrets (names only) and each agent's memory. */
export function ForjaSetup() {
  return (
    <div className="flex flex-col gap-3 p-3">
      <Versions />
      <Secrets />
      <Memory />
    </div>
  );
}

const short = (hash: string | null | undefined) => (hash ? hash.slice(0, 10) : "–");

function Versions() {
  const { t } = useI18n();
  const explain = useExplain();
  const projects = useLoad(() => forjaApi.projects());
  const [workspace, setWorkspace] = useState("");
  const [validation, setValidation] = useState<Validation | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [factory, setFactory] = useState("");
  const state = useLoad(() => (factory ? forjaApi.state(factory) : Promise.resolve({ stable: null, canary: null })));
  useEffect(() => {
    state.reload();
  }, [factory, state.reload]);

  const list = projects.result.state === "ready" ? (Array.isArray(projects.result.data) ? projects.result.data : projects.result.data.projects) : [];
  const guard = async (run: () => Promise<void>) => {
    try {
      await run();
      setMessage(null);
    } catch (e) {
      setMessage(explain(e));
    }
  };

  const check = () =>
    guard(async () => {
      const v = await forjaApi.validate(workspace);
      setValidation(v);
      if (v.name) setFactory(v.name);
    });
  const activate = (mode: "stable" | "canary") =>
    guard(async () => {
      if (!validation?.hash) return;
      await forjaApi.activate({ workspace, expected_hash: validation.hash, mode, ...(mode === "canary" ? { percent: CANARY_PERCENT } : {}) });
      await check();
      state.reload();
    });
  const change = (call: () => Promise<unknown>) =>
    guard(async () => {
      await call();
      state.reload();
    });

  if (projects.result.state === "offline") return <OfflineNotice onRetry={projects.reload} />;
  const current = state.result.state === "ready" ? state.result.data : { stable: null, canary: null };
  return (
    <Panel title={t("forja.setup.versions")} level={2}>
      <div className="flex flex-col gap-3 p-3 text-body">
        {message && <Notice tone="warn">{message}</Notice>}
        {current.stable ? <p>{t("forja.setup.active", { hash: short(current.stable.hash) })}</p> : <p className="text-ink-mute">{t("forja.setup.noVersion")}</p>}
        {current.canary && <p>{t("forja.setup.canary", { percent: current.canary.percent ?? 0, hash: short(current.canary.hash) })}</p>}
        <div className="flex flex-wrap gap-2">
          {current.canary ? (
            <>
              <Button size="sm" onClick={() => void change(() => forjaApi.promote(factory))}>{t("forja.setup.promote")}</Button>
              <Button size="sm" variant="ghost" onClick={() => void change(() => forjaApi.abort(factory))}>{t("forja.setup.abort")}</Button>
            </>
          ) : (
            current.stable && <Button size="sm" variant="ghost" onClick={() => void change(() => forjaApi.rollback(factory))}>{t("forja.setup.rollback")}</Button>
          )}
        </div>
        {list.length === 0 ? (
          <p className="text-ink-mute">{t("forja.setup.projectNone")}</p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="font-medium text-ink-dim">{t("forja.setup.project")}</span>
              <select className="h-control-md rounded-control border border-line-strong bg-sub-000 px-2 text-title" value={workspace} onChange={(e) => { setWorkspace(e.target.value); setValidation(null); }}>
                <option value="" />
                {list.map((p) => (
                  <option key={p.id} value={p.rootPath}>{p.name}</option>
                ))}
              </select>
            </label>
            <Button size="sm" onClick={() => void check()} disabled={!workspace}>{t("forja.setup.check")}</Button>
          </div>
        )}
        {validation && (
          <div className="flex flex-col gap-2" role="status">
            <p>{validation.ok ? t("forja.setup.valid") : t("forja.setup.invalid")}</p>
            {!validation.ok && (
              <ul className="list-disc pl-5 text-fault-text">
                {validation.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>{`${e.file}${e.path ? ` · ${e.path}` : ""}: ${e.message}`}</li>
                ))}
              </ul>
            )}
            {validation.ok && (validation.update_available ? <p>{t("forja.setup.changes", { n: validation.changes.length })}</p> : <p className="text-ink-mute">{t("forja.setup.nothingNew")}</p>)}
            {validation.ok && validation.update_available && !current.canary && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={() => void activate("stable")}>{t("forja.setup.activate")}</Button>
                {current.stable && <Button size="sm" onClick={() => void activate("canary")}>{t("forja.setup.activateTrial", { percent: CANARY_PERCENT })}</Button>}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

function Secrets() {
  const { t } = useI18n();
  const explain = useExplain();
  const { result, reload } = useLoad(() => forjaApi.secrets());
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const run = async (call: () => Promise<unknown>) => {
    try {
      await call();
      setMessage(null);
      reload();
    } catch (e) {
      setMessage(explain(e));
    }
  };
  const rows: SecretRow[] = result.state === "ready" ? result.data.secrets : [];
  return (
    <Panel title={t("forja.setup.secrets")} level={2}>
      <div className="flex flex-col gap-3 p-3 text-body">
        <p className="text-ink-dim">{t("forja.setup.secretsNote")}</p>
        {message && <Notice tone="warn">{message}</Notice>}
        {rows.length === 0 ? (
          <p className="text-ink-mute">{t("forja.setup.secretsNone")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map((s) => (
              <li key={s.name} className="flex items-center justify-between gap-2">
                <span className="font-mono">{s.reference}</span>
                <Button size="sm" variant="ghost" aria-label={t("forja.setup.secretDelete", { name: s.name })} onClick={() => void run(() => forjaApi.deleteSecret(s.name))}>
                  {t("forja.setup.secretDelete", { name: s.name })}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Input label={t("forja.setup.secretName")} mono value={name} onChange={(e) => setName(e.target.value)} compact />
          <Input label={t("forja.setup.secretValue")} type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} compact />
          <Button size="sm" disabled={!name || !value} onClick={() => void run(async () => { await forjaApi.putSecret(name, value); setValue(""); setName(""); })}>
            {t("forja.setup.secretSave")}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function Memory() {
  const { t } = useI18n();
  const explain = useExplain();
  const [factory, setFactory] = useState("");
  const [agent, setAgent] = useState("");
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const { result, reload } = useLoad(() => (factory && agent ? forjaApi.memory(factory, agent) : Promise.resolve({ notes: [] as MemoryNote[] })));
  useEffect(() => {
    reload();
  }, [factory, agent, reload]);
  const run = async (call: () => Promise<unknown>) => {
    try {
      await call();
      setMessage(null);
      reload();
    } catch (e) {
      setMessage(explain(e));
    }
  };
  const notes = result.state === "ready" ? result.data.notes : [];
  return (
    <Panel title={t("forja.setup.memory")} level={2}>
      <div className="flex flex-col gap-3 p-3 text-body">
        {message && <Notice tone="warn">{message}</Notice>}
        <div className="flex flex-wrap items-end gap-2">
          <Input label="Forja" mono compact value={factory} onChange={(e) => setFactory(e.target.value)} />
          <Input label={t("forja.setup.memoryAgent")} mono compact value={agent} onChange={(e) => setAgent(e.target.value)} />
        </div>
        {notes.length === 0 ? (
          <p className="text-ink-mute">{t("forja.setup.memoryNone")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((n) => (
              <li key={n.id} className="flex flex-col gap-1 rounded-control border border-line-soft bg-sub-200 p-2">
                <span>{n.text}</span>
                {!n.reviewed && <span className="text-warn-text">{t("forja.setup.memoryUnreviewed")}</span>}
                <span className="flex gap-2">
                  {!n.reviewed && <Button size="sm" variant="ghost" onClick={() => void run(() => forjaApi.editNote(n.id, { reviewed: true }))}>{t("forja.setup.memoryReview")}</Button>}
                  <Button size="sm" variant="ghost" onClick={() => void run(() => forjaApi.deleteNote(n.id))}>{t("forja.setup.memoryDelete")}</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Input label={t("forja.setup.memoryText")} compact value={text} onChange={(e) => setText(e.target.value)} />
          <Button size="sm" disabled={!factory || !agent || !text.trim()} onClick={() => void run(async () => { await forjaApi.addNote(factory, agent, text); setText(""); })}>
            {t("forja.setup.memoryAdd")}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
