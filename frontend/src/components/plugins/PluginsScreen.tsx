"use client";

import { useEffect, useState } from "react";
import { Button, Notice, Segmented } from "@/components/ui";
import { useT } from "@/i18n/store";
import { usePluginsStore } from "@/store/pluginsStore";
import { AddFlow } from "./AddFlow";
import { CreateTab } from "./CreateTab";
import { DiscoverTab } from "./DiscoverTab";
import { InstalledList } from "./InstalledList";
import { ShareSheet } from "./ShareSheet";
import { errorText } from "./text";

type Tab = "installed" | "discover" | "create";

/** Plugins: installed packages, an unreviewed index, and a creator mode that does not send the draft. */
export function PluginsScreen() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("installed");
  const refresh = usePluginsStore((s) => s.refresh);
  const hostState = usePluginsStore((s) => s.hostState);
  const error = usePluginsStore((s) => s.error);
  const message = errorText(t, error);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const offline = hostState === "offline" || hostState === "unavailable" || hostState === "failed";

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4">
      <h1 className="t-title text-ink">{t("plugins.title")}</h1>
      <Segmented
        label={t("plugins.tabs.label")}
        value={tab}
        onChange={setTab}
        options={[
          { value: "installed", label: t("plugins.tabs.installed") },
          { value: "discover", label: t("plugins.tabs.discover") },
          { value: "create", label: t("plugins.tabs.create") },
        ]}
      />
      {offline && (
        <Notice
          tone="fault"
          title={t("plugins.host.downTitle")}
          action={<Button size="sm" onClick={() => void refresh()}>{t("plugins.host.retry")}</Button>}
        >
          {t("plugins.host.downBody")}
        </Notice>
      )}
      {message && error !== "offline" && <Notice tone="warn" title={message} />}
      {tab === "installed" && (
        <>
          <AddFlow onProposed={() => setTab("create")} />
          <InstalledList />
        </>
      )}
      {tab === "discover" && <DiscoverTab onInspect={() => setTab("installed")} />}
      {tab === "create" && <CreateTab onInspect={() => setTab("installed")} />}
      <ShareSheet />
    </div>
  );
}
