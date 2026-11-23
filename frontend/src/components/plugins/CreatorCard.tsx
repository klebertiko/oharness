"use client";
import Link from "next/link";
import { Check, Copy, MessageSquare, Sparkles } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import { usePluginsStore } from "@/store/pluginsStore";

/**
 * "Let Nilo create a plugin": turns creator mode on (Nilo gets the cordis_plugins tool in chat) and hands the person a draft to paste in the
 * chat. Nothing is sent for them: the chat has no way to receive a draft from here, so the draft is copied and the chat is one link away.
 */
export function CreatorCard({ canChange }: { canChange: boolean }) {
  const { t } = useI18n();
  const titleId = useId();
  const draftId = useId();
  const creator = usePluginsStore((s) => s.creator);
  const setCreator = usePluginsStore((s) => s.setCreator);
  const [copied, setCopied] = useState(false);
  const [working, setWorking] = useState(false);
  const draft = t("plugins.creator.draftText");

  if (creator === null) return null; // a sidecar without creator mode
  const toggle = async (on: boolean) => {
    setWorking(true);
    await setCreator(on);
    setWorking(false);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
    } catch {
      setCopied(false); // the text stays selectable in the box
    }
  };

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2 rounded-panel border border-line-soft bg-sub-100 p-3">
      <h2 id={titleId} className="t-heading flex items-center gap-2 text-ink">
        <Sparkles size={16} aria-hidden />
        {t("plugins.creator.title")}
      </h2>
      <p className="text-body text-ink-dim">{t("plugins.creator.body")}</p>
      {!creator ? (
        <div>
          <Button variant="primary" disabled={!canChange} loading={working} onClick={() => void toggle(true)}>
            {t("plugins.creator.start")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-body font-medium text-ink">
            <Check size={14} aria-hidden />
            {t("plugins.creator.on")}
          </p>
          <label htmlFor={draftId} className="text-body font-medium text-ink">
            {t("plugins.creator.draft")}
          </label>
          <textarea id={draftId} readOnly rows={3} value={draft} className="w-full resize-none rounded-control border border-line-strong bg-sub-200 p-2 text-body text-ink" />
          <p className="text-meta text-ink-mute">{t("plugins.creator.hint")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} onClick={() => void copy()}>
              {copied ? t("plugins.creator.copied") : t("plugins.creator.copy")}
            </Button>
            <Link href="/" className="inline-flex min-h-control-sm items-center gap-1 rounded-control px-2 text-body font-medium text-signal-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-(--signal)">
              <MessageSquare size={14} aria-hidden />
              {t("plugins.creator.openChat")}
            </Link>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" disabled={!canChange} loading={working} onClick={() => void toggle(false)}>
              {t("plugins.creator.stop")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
