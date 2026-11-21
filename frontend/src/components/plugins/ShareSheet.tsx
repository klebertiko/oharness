"use client";

import { Button, Sheet } from "@/components/ui";
import { useT } from "@/i18n/store";
import { usePluginsStore } from "@/store/pluginsStore";

/** Export builds a static index and an archive. The sheet says no package code ran. */
export function ShareSheet() {
  const t = useT();
  const share = usePluginsStore((s) => s.share);
  const closeShare = usePluginsStore((s) => s.closeShare);
  return (
    <Sheet open={share !== null} onOpenChange={(open) => { if (!open) closeShare(); }} title={t("plugins.share.title")} showClose>
      {share && (
        <div className="flex min-w-0 flex-col gap-3 overflow-auto p-3">
          <p className="text-body text-ink-dim">{t("plugins.share.lead")}</p>
          <p className="text-body text-ink">{t("plugins.share.scripts")}</p>
          <p className="text-body text-ink">{share.target === "npm" ? t("plugins.share.nextNpm") : t("plugins.share.nextGit")}</p>
          <h3 className="t-title text-ink">{t("plugins.share.index")}</h3>
          <pre className="max-h-60 min-w-0 overflow-auto rounded-control border border-line-soft bg-sub-200 p-2 font-mono text-code text-ink">{JSON.stringify(share.index, null, 2)}</pre>
          <p className="font-mono text-code text-ink-mute">{share.filename}</p>
          <Button variant="secondary" onClick={closeShare}>{t("plugins.share.close")}</Button>
        </div>
      )}
    </Sheet>
  );
}
