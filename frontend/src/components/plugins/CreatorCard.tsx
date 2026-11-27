"use client";
import Link from "next/link";
import { Check, MessageSquare, Sparkles } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import { NEW_CHAT_KEY, useChatModelStore } from "@/store/chatModelStore";
import { NEW_DRAFT_KEY, useComposerDraftStore } from "@/store/composerDraftStore";
import { usePluginsStore } from "@/store/pluginsStore";
import { useThreadStore } from "@/store/threadStore";

/**
 * "Let Nilo create a plugin": turns creator mode on for the active chat thread (Nilo gets the cordis_plugins tool in that thread only).
 * Nothing is sent and the composer's draft is not touched; with no chat open yet, one is created and selected, and the unsent draft of the
 * new chat goes with it. The chat is one link away.
 */
export function CreatorCard({ canChange }: { canChange: boolean }) {
  const { t } = useI18n();
  const titleId = useId();
  const activeThreadId = useThreadStore((s) => s.activeThreadId);
  const on = usePluginsStore((s) => (activeThreadId ? s.creatorByThread[activeThreadId] === true : false));
  const loadCreator = usePluginsStore((s) => s.loadCreator);
  const setCreator = usePluginsStore((s) => s.setCreator);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (activeThreadId) void loadCreator(activeThreadId);
  }, [activeThreadId, loadCreator]);

  const start = async () => {
    setWorking(true);
    let threadId = useThreadStore.getState().activeThreadId;
    if (!threadId) {
      threadId = useThreadStore.getState().createThread(t("plugins.creator.threadTitle"));
      useChatModelStore.getState().adopt(NEW_CHAT_KEY, threadId);
      useComposerDraftStore.getState().moveDraft(NEW_DRAFT_KEY, threadId);
    }
    await setCreator(threadId, true);
    setWorking(false);
  };
  const stop = async () => {
    if (!activeThreadId) return;
    setWorking(true);
    await setCreator(activeThreadId, false);
    setWorking(false);
  };

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2 rounded-panel border border-line-soft bg-sub-100 p-3">
      <h2 id={titleId} className="t-heading flex items-center gap-2 text-ink">
        <Sparkles size={16} aria-hidden />
        {t("plugins.creator.title")}
      </h2>
      <p className="text-body text-ink-dim">{t("plugins.creator.body")}</p>
      {!on ? (
        <div>
          <Button variant="primary" disabled={!canChange} loading={working} onClick={() => void start()}>
            {t("plugins.creator.start")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-body font-medium text-ink">
            <Check size={14} aria-hidden />
            {t("plugins.creator.on")}
          </p>
          <p className="text-meta text-ink-mute">{t("plugins.creator.hint")}</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/" className="inline-flex min-h-control-sm items-center gap-1 rounded-control px-2 text-body font-medium text-signal-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-(--signal)">
              <MessageSquare size={14} aria-hidden />
              {t("plugins.creator.openChat")}
            </Link>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" disabled={!canChange} loading={working} onClick={() => void stop()}>
              {t("plugins.creator.stop")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
