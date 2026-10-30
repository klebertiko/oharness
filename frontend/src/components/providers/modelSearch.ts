/**
 * Searching the combo's models (docs/adr/0015-model-list-shape.md): one
 * flat list grouped by connection, filtered by what the person types. A
 * connection like OpenRouter serves hundreds of ids, so each group shows a
 * capped slice and says how many more a longer query would reveal.
 */
export type ModelGroupInput = { connectionId: string; label: string; models: string[] };
export type ModelGroupResult = { connectionId: string; label: string; items: string[]; hidden: number };

/** Rows a group shows before the person has typed anything, and once they have. */
export const IDLE_CAP = 8;
export const QUERY_CAP = 25;

const words = (id: string) => id.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** 0 = no match; higher is better. Every query token must match. */
export function scoreModel(id: string, query: string): number {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 1;
  const lower = id.toLowerCase();
  const parts = words(id);
  let score = 0;
  for (const t of tokens) {
    let s = 0;
    if (lower === t) s = 100;
    else if (lower.startsWith(t)) s = 60;
    else if (parts.some((p) => p.startsWith(t))) s = 40;
    else if (lower.includes(t)) s = 15;
    if (!s) return 0;
    score += s;
  }
  // Shorter ids first among equals: "gpt-4o" before "gpt-4o-mini-2024-07-18".
  return score + Math.max(0, 10 - Math.floor(lower.length / 12));
}

export function filterModelGroups(groups: ModelGroupInput[], query: string): ModelGroupResult[] {
  const q = query.trim();
  const cap = q ? QUERY_CAP : IDLE_CAP;
  const out: ModelGroupResult[] = [];
  for (const g of groups) {
    const matched = q
      ? g.models
          .map((id) => ({ id, s: scoreModel(id, q) }))
          .filter((m) => m.s > 0)
          .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
          .map((m) => m.id)
      : g.models;
    // A typed query drops groups with no match; an empty one keeps every group.
    if (q && matched.length === 0) continue;
    out.push({ connectionId: g.connectionId, label: g.label, items: matched.slice(0, cap), hidden: Math.max(0, matched.length - cap) });
  }
  return out;
}
