"use client";
import { useI18n } from "@/i18n/store";
import type { MessageKey } from "@/i18n/translate";
import type { FetchEvent } from "./types";

const STEP_KEY: Record<string, MessageKey> = {
  downloading: "plugins.fetchStep.downloading",
  copying: "plugins.fetchStep.copying",
  verifying: "plugins.fetchStep.verifying",
  extracting: "plugins.fetchStep.extracting",
  "preview-ready": "plugins.fetchStep.preview-ready",
  installing: "plugins.fetchStep.installing",
  done: "plugins.fetchStep.done",
  failed: "plugins.fetchStep.failed",
  cancelled: "plugins.fetchStep.cancelled",
};

/**
 * The steps the sidecar reports for a download and its install, in order. It is a polite live region, mounted before the first step
 * arrives so a screen reader announces each new line; the text is ours (catalog), never the sidecar's.
 */
export function FetchLog({ events }: { events: FetchEvent[] }) {
  const { t } = useI18n();
  const known = events.filter((event) => event.step in STEP_KEY);
  return (
    <div role="log" aria-live="polite" aria-label={t("plugins.fetch.log")}>
      <ol className="flex flex-col gap-0.5 rounded-control border border-line-soft bg-sub-200 px-3 py-2 text-body empty:hidden">
        {known.map((event, i) => (
          <li key={`${event.step}-${i}`} className={i === known.length - 1 ? (event.step === "failed" ? "font-medium text-fault-text" : "font-medium text-ink") : "text-ink-dim"}>
            {t(STEP_KEY[event.step])}
          </li>
        ))}
      </ol>
    </div>
  );
}
