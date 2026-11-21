"use client";

import { useEffect, useState } from "react";
import { Button, Input, Notice, Panel } from "@/components/ui";
import { useT } from "@/i18n/store";
import type { MessageKey } from "@/i18n/messages.en";
import { usePluginsStore } from "@/store/pluginsStore";

const API_TEXT: Record<string, MessageKey> = {
  tools: "plugins.create.api.tools",
  commands: "plugins.create.api.commands",
  events: "plugins.create.api.events",
  services: "plugins.create.api.services",
};

/** Creator mode keeps the draft, sends nothing, and asks for each install on its own. */
export function CreateTab({ onInspect }: { onInspect: () => void }) {
  const t = useT();
  const draft = usePluginsStore((s) => s.draft);
  const setDraft = usePluginsStore((s) => s.setDraft);
  const sessionMode = usePluginsStore((s) => s.sessionMode);
  const enterCreatorMode = usePluginsStore((s) => s.enterCreatorMode);
  const actions = usePluginsStore((s) => s.actions);
  const lastResult = usePluginsStore((s) => s.lastResult);
  const approveAction = usePluginsStore((s) => s.approveAction);
  const rejectAction = usePluginsStore((s) => s.rejectAction);
  const apis = usePluginsStore((s) => s.apis);
  const loadApis = usePluginsStore((s) => s.loadApis);
  const writtenFiles = usePluginsStore((s) => s.writtenFiles);
  const writeStarter = usePluginsStore((s) => s.writeStarter);
  const inspect = usePluginsStore((s) => s.inspect);
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [writtenPath, setWrittenPath] = useState<string | null>(null);

  useEffect(() => {
    if (sessionMode === "creator") void loadApis();
  }, [sessionMode, loadApis]);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="max-w-[62ch] text-body text-ink-dim">{t("plugins.create.lead")}</p>
      <label className="flex min-w-0 flex-col gap-1 text-body font-medium text-ink-dim" htmlFor="plugin-draft">
        {t("plugins.create.draft")}
        <textarea
          id="plugin-draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={4}
          className="min-h-24 w-full resize-y rounded-control border border-line-strong bg-sub-100 px-2 py-2 text-body font-normal text-ink placeholder:text-ink-mute hover:bg-sub-200 focus-visible:border-signal"
          placeholder={t("plugins.create.draftHint")}
        />
      </label>
      {sessionMode === "session" ? (
        <Button variant="primary" onClick={() => enterCreatorMode()}>{t("plugins.create.enter")}</Button>
      ) : (
        <Notice tone="info" title={t("plugins.create.active")}>{t("plugins.create.apisBody")}</Notice>
      )}

      {sessionMode === "creator" && (
        <>
          <Panel variant="inset" title={t("plugins.create.apisTitle")} titleId="plugin-apis" level={2} bodyClassName="flex flex-col gap-2 p-3">
            <ul className="flex flex-col gap-1">
              {(apis.length ? apis : [{ id: "tools", access: "read" as const }, { id: "commands", access: "read" as const }, { id: "events", access: "read" as const }, { id: "services", access: "read" as const }]).map((api) => {
                const about = API_TEXT[api.id];
                return (
                  <li key={api.id} className="text-body text-ink">
                    <span className="font-medium">{api.id}</span>
                    <span className="text-ink-dim"> · {about ? t(about) : api.access}</span>
                  </li>
                );
              })}
            </ul>
          </Panel>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={t("plugins.create.folder")} value={folder} onChange={(e) => setFolder(e.target.value)} mono autoComplete="off" />
            <Input label={t("plugins.create.name")} value={name} onChange={(e) => setName(e.target.value)} mono autoComplete="off" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={!folder.trim() || !name.trim()}
              onClick={() => {
                void writeStarter(folder.trim(), name.trim()).then((path) => setWrittenPath(path));
              }}
            >
              {t("plugins.create.write")}
            </Button>
            {writtenPath && (
              <Button
                variant="secondary"
                onClick={() => {
                  void inspect({ kind: "local", spec: writtenPath });
                  onInspect();
                }}
              >
                {t("plugins.create.inspect")}
              </Button>
            )}
          </div>
          {writtenFiles.length > 0 && <p className="text-body text-ink-dim">{t("plugins.create.written", { files: writtenFiles.join(", ") })}</p>}
        </>
      )}

      <section aria-label={t("plugins.create.actionsTitle")} className="flex flex-col gap-2">
        <h2 className="t-title text-ink">{t("plugins.create.actionsTitle")}</h2>
        {actions.filter((action) => action.status === "pending" || action.status === "approving").length === 0 && (
          <p className="text-body text-ink-mute">{t("plugins.create.actionsEmpty")}</p>
        )}
        <ul className="flex flex-col gap-2">
          {actions.filter((action) => action.status !== "rejected").map((action) => (
            <li key={action.id} className="flex min-w-0 flex-col gap-2 rounded-control border border-line-soft bg-sub-100 p-3">
              <p className="text-body text-ink">{action.summary}</p>
              <p className="text-meta text-ink-mute">{action.status === "approved" ? t("plugins.create.applied", { name: action.name, version: action.version }) : t("plugins.create.pending")}</p>
              {action.status === "pending" || action.status === "approving" ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" loading={action.status === "approving"} onClick={() => void approveAction(action.id)}>{t("plugins.create.approve")}</Button>
                  <Button variant="danger" onClick={() => void rejectAction(action.id)}>{t("plugins.create.reject")}</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {lastResult && (
          <Notice tone="info" title={t("plugins.create.applied", { name: lastResult.name, version: lastResult.version })}>
            {t("plugins.create.next")}
          </Notice>
        )}
      </section>
    </div>
  );
}
