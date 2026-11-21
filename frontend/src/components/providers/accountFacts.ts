const PLANS = new Set(["Pro", "Max", "Plus", "Team", "Free", "Enterprise", "Business", "Ultra"]);

/** A fact value safe to show. An address is never shown. A plan must be one of the enumerated names. */
export function visibleFact(key: string, value: string): string | null {
  if (!value || value.includes("@")) return null;
  if (key === "plan") return PLANS.has(value) ? value : null;
  return value;
}
