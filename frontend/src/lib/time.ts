import { tr } from "@/i18n/store";

/** Compact relative-time labels ("2mo", "3d", "just now") for real ISO timestamps. */
export function formatRelativeTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";

  const diffSec = Math.round((Date.now() - t) / 1000);
  const abs = Math.abs(diffSec);
  const future = diffSec < 0;

  const label = (key: "chat.time.minutes" | "chat.time.hours" | "chat.time.days" | "time.months" | "time.years", n: number) => {
    const text = tr(key, { n });
    return future ? tr("time.future", { value: text }) : text;
  };

  if (abs < 60) return tr("time.justNow");
  const min = Math.round(abs / 60);
  if (min < 60) return label("chat.time.minutes", min);
  const hr = Math.round(min / 60);
  if (hr < 24) return label("chat.time.hours", hr);
  const day = Math.round(hr / 24);
  if (day < 30) return label("chat.time.days", day);
  const month = Math.round(day / 30);
  if (month < 12) return label("time.months", month);
  const year = Math.round(month / 12);
  return label("time.years", year);
}
