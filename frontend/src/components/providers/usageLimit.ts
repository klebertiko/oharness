/** An ISO reset instant we are willing to keep. Anything else is dropped. */
const RESET_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** The furthest ahead a reset may be: 14 days, the same cap the sidecar puts on Retry-After. */
const MAX_AHEAD_MS = 14 * 24 * 60 * 60 * 1000;

export function cleanResetAt(value: unknown, now = Date.now()): string | null {
  if (typeof value !== "string" || !RESET_AT.test(value)) return null;
  if (value.includes("@") || /\s/.test(value)) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  if (parsed - now > MAX_AHEAD_MS) return null;
  return value;
}

/** Local clock of a reset instant, `HH:MM`, or null when the instant is not usable. */
export function formatResetLocal(resetAt: string | null | undefined, locale: string): string | null {
  const clean = cleanResetAt(resetAt);
  if (!clean) return null;
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(clean));
}

/** Milliseconds until `resetAt`, never negative. Null when the instant is not usable. */
export function msUntil(resetAt: string | null | undefined, now = Date.now()): number | null {
  const clean = cleanResetAt(resetAt, now);
  if (!clean) return null;
  return Math.max(0, Date.parse(clean) - now);
}
