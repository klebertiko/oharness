"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/store";
import { ForjaError } from "./forjaApi";

export type LoadState<T> = { state: "loading" } | { state: "offline" } | { state: "ready"; data: T };

/** Runs `fn` on mount and whenever `reload()` is called. A failed call is `offline`, never a thrown error in the render. */
export function useLoad<T>(fn: () => Promise<T>): { result: LoadState<T>; reload: () => void } {
  const [result, setResult] = useState<LoadState<T>>({ state: "loading" });
  const latest = useRef(fn);
  latest.current = fn;
  const reload = useCallback(() => {
    latest.current().then(
      (data) => setResult({ state: "ready", data }),
      () => setResult({ state: "offline" }),
    );
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  return { result, reload };
}

/** A person-readable sentence for a failed call: a missing human credential is its own plain message. */
export function useExplain() {
  const { t } = useI18n();
  return useCallback(
    (error: unknown) => (error instanceof ForjaError && error.code === "human_only" ? t("forja.humanOnly") : t("forja.actionFailed", { reason: error instanceof Error ? error.message : String(error) })),
    [t],
  );
}

/** A duration in seconds as the largest sensible unit. */
export function useDuration() {
  const { t, number } = useI18n();
  return (seconds: number | null | undefined) => {
    if (seconds == null) return "–";
    if (seconds < 3600) return t("forja.duration.minutes", { n: number(Math.max(1, Math.round(seconds / 60))) });
    if (seconds < 86400) return t("forja.duration.hours", { n: number(Math.round((seconds / 3600) * 10) / 10) });
    return t("forja.duration.days", { n: number(Math.round((seconds / 86400) * 10) / 10) });
  };
}
