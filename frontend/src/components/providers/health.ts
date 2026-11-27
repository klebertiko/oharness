/** A focus check runs at most once a minute per connection. */
export function shouldProbe(lastAt: number | undefined, now: number, intervalMs = 60_000): boolean {
  if (lastAt == null) return true;
  return now - lastAt >= intervalMs;
}

export function testedAgo(iso: string, now: number): { unit: "min" | "h"; n: number } | null {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 60) return { unit: "min", n: minutes };
  return { unit: "h", n: Math.round(minutes / 60) };
}
