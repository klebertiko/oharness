"use client";
import { useState } from "react";
import { Button, Input, Segmented } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import type { MessageKey } from "@/i18n/translate";
import type { FetchRequest, SourceKind } from "./types";

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const COMMIT = /^[0-9a-fA-F]{40}$/;

interface Fields {
  name: string;
  version: string;
  repo: string;
  commit: string;
  subdir: string;
  path: string;
}
type Errors = Partial<Record<keyof Fields, MessageKey>>;

/** Checks the fields of the chosen source. The sidecar checks again; this only spares a round trip. */
export function validate(kind: SourceKind, f: Fields): { request: FetchRequest | null; errors: Errors } {
  const errors: Errors = {};
  if (kind === "npm") {
    if (!f.name.trim()) errors.name = "plugins.add.err.name";
    if (!EXACT_VERSION.test(f.version.trim())) errors.version = "plugins.add.err.version";
    return { errors, request: Object.keys(errors).length ? null : { kind, spec: f.name.trim(), version: f.version.trim() } };
  }
  if (kind === "github") {
    if (!REPO.test(f.repo.trim())) errors.repo = "plugins.add.err.repo";
    if (!COMMIT.test(f.commit.trim())) errors.commit = "plugins.add.err.commit";
    const subdir = f.subdir.trim();
    return { errors, request: Object.keys(errors).length ? null : { kind, spec: f.repo.trim(), commit: f.commit.trim().toLowerCase(), ...(subdir ? { subdir } : {}) } };
  }
  if (!f.path.trim()) errors.path = "plugins.add.err.path";
  return { errors, request: Object.keys(errors).length ? null : { kind, spec: f.path.trim() } };
}

const EMPTY: Fields = { name: "", version: "", repo: "", commit: "", subdir: "", path: "" };

/** The first step of adding a plugin: where it comes from. Nothing is downloaded until Check package. */
export function AddForm({ onSubmit, onCancel }: { onSubmit: (request: FetchRequest) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<SourceKind>("npm");
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const set = (key: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => setFields((f) => ({ ...f, [key]: e.target.value }));
  const err = (key: keyof Fields) => (errors[key] ? t(errors[key]) : undefined);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = validate(kind, fields);
    setErrors(result.errors);
    if (result.request) onSubmit(result.request);
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      <Segmented
        label={t("plugins.add.source")}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setErrors({});
        }}
        options={[
          { value: "npm", label: t("plugins.add.tab.npm") },
          { value: "github", label: t("plugins.add.tab.github") },
          { value: "local", label: t("plugins.add.tab.local") },
        ]}
      />
      {kind === "npm" && (
        <>
          <Input mono label={t("plugins.add.npm.name")} value={fields.name} onChange={set("name")} error={err("name")} autoComplete="off" spellCheck={false} />
          <Input mono label={t("plugins.add.npm.version")} hint={t("plugins.add.npm.versionHint")} value={fields.version} onChange={set("version")} error={err("version")} autoComplete="off" spellCheck={false} />
        </>
      )}
      {kind === "github" && (
        <>
          <Input mono label={t("plugins.add.github.repo")} value={fields.repo} onChange={set("repo")} error={err("repo")} autoComplete="off" spellCheck={false} />
          <Input mono label={t("plugins.add.github.commit")} hint={t("plugins.add.github.commitHint")} value={fields.commit} onChange={set("commit")} error={err("commit")} autoComplete="off" spellCheck={false} />
          <Input mono label={t("plugins.add.github.subdir")} value={fields.subdir} onChange={set("subdir")} autoComplete="off" spellCheck={false} />
        </>
      )}
      {kind === "local" && <Input mono label={t("plugins.add.local.path")} hint={t("plugins.add.local.pathHint")} value={fields.path} onChange={set("path")} error={err("path")} autoComplete="off" spellCheck={false} />}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>{t("plugins.add.cancel")}</Button>
        <Button type="submit" variant="primary">
          {t("plugins.add.fetch")}
        </Button>
      </div>
    </form>
  );
}
