import { tr, trn } from "@/i18n/store";

/** Compact relative-time labels ("2mo", "3d", "just now") for real ISO timestamps. */
export function formatRelativeTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";

  const diffSec = Math.round((Date.now() - t) / 1000);
  const abs = Math.abs(diffSec);
  const future = diffSec < 0;

  const wrap = (text: string) => (future ? tr("time.future", { value: text }) : text);
  const unit = (key: "time.minutes" | "time.hours" | "time.days", n: number) => wrap(tr(key, { n }));
  const plural = (key: "time.months" | "time.years", n: number) => wrap(trn(key, n));

  if (abs < 60) return tr("time.justNow");
  const min = Math.round(abs / 60);
  if (min < 60) return unit("time.minutes", min);
  const hr = Math.round(min / 60);
  if (hr < 24) return unit("time.hours", hr);
  const day = Math.round(hr / 24);
  if (day < 30) return unit("time.days", day);
  const month = Math.round(day / 30);
  if (month < 12) return plural("time.months", month);
  const year = Math.round(month / 12);
  return plural("time.years", year);
}

/** Whether a timestamp is within the last minute, ahead of the clock, or neither; lets callers phrase "edited …" without parsing the label. */
export function relativeKind(iso: string | undefined | null): "unknown" | "now" | "past" | "future" {
  if (!iso || Number.isNaN(Date.parse(iso))) return "unknown";
  const diffSec = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (diffSec < 0 && Math.abs(diffSec) >= 60) return "future";
  return Math.abs(diffSec) < 60 ? "now" : "past";
}
