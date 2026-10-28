import { filterModelGroups } from "@/components/providers/modelSearch";
import type { ComboOption } from "@/components/ui/Combobox";
import type { Connection } from "@/components/providers/providerStore";

/** Option id for "Auto" — no connection id is empty. */
export const AUTO_ID = "";
/** Separates connection id from model id in a model row's option id. */
const SEP = "␟";
/** Disabled row that says a group has more models than it shows. */
const MORE = "more";

export const modelOptionId = (connectionId: string, model: string) => connectionId + SEP + model;
export const connectionOptionId = (connectionId: string) => connectionId;

/** What a combo option id means: Auto, a whole connection (no model list), or one model of a connection. */
export function parseOptionId(id: string): { connectionId: string | null; model: string | null; auto: boolean } | null {
  if (id === AUTO_ID) return { connectionId: null, model: null, auto: true };
  if (id.startsWith(MORE + SEP)) return null;
  const at = id.indexOf(SEP);
  if (at < 0) return { connectionId: id, model: null, auto: false };
  return { connectionId: id.slice(0, at), model: id.slice(at + 1), auto: false };
}

/** The models a connection offers in the combo: the endpoint's list when it has one, else the catalog's.
    The model in effect (the default, or this chat's own pin) is always among them, even when it is a custom id. */
export function modelIds(c: Connection, current = c.defaultModel): string[] {
  const ids = c.models.map((m) => m.id);
  if (current && !ids.includes(current)) ids.unshift(current);
  return ids;
}

/** The option that is currently selected for a connection: its model in effect, or the connection row when it has no model list. */
export function selectedOptionId(c: Connection, current: string): string {
  return modelIds(c, current).length ? modelOptionId(c.id, current || c.defaultModel) : connectionOptionId(c.id);
}

/** Show the model in effect first, so it is on screen before anything is typed. */
function withCurrentFirst(ids: string[], current: string): string[] {
  return current && ids.includes(current) ? [current, ...ids.filter((id) => id !== current)] : ids;
}

/** Rebuild the option list after a typed query: ranked, capped per group, groups with no match dropped.
    Matching is on what the person reads (the model name), never on the option id. */
export function filterComboOptions(options: ComboOption[], query: string): ComboOption[] {
  const byGroup = new Map<string, ComboOption[]>();
  for (const o of options) {
    const g = o.group ?? "";
    byGroup.set(g, [...(byGroup.get(g) ?? []), o]);
  }
  const out: ComboOption[] = [];
  for (const [group, rows] of byGroup) {
    // Rows that share a label (the same model under two connections) are handed back in order, never merged.
    const byLabel = new Map<string, ComboOption[]>();
    for (const r of rows) byLabel.set(r.label, [...(byLabel.get(r.label) ?? []), r]);
    const hit = filterModelGroups([{ connectionId: group, label: group, models: rows.map((r) => r.label) }], query)[0];
    if (!hit || hit.items.length === 0) continue;
    out.push(...hit.items.map((label) => byLabel.get(label)?.shift()).filter((o): o is ComboOption => Boolean(o)));
    if (hit.hidden) {
      out.push({ id: `${MORE}${SEP}${group}`, label: query.trim() ? `${hit.hidden} more. Keep typing to narrow.` : `${hit.hidden} more. Type to search.`, group: group || undefined, disabled: true });
    }
  }
  return out;
}

export type ComboBuildInput = {
  connections: Connection[];
  chosenId: string | null;
  autoDetail: string;
  autoTone: ComboOption["leading"];
  /** Connections that can answer now (plus a chosen one that has since stopped). */
  usable: Connection[];
  overrideFor: (connectionId: string) => string;
  toneDot: (c: Connection) => ComboOption["leading"];
  rowDetail: (c: Connection) => string;
};

/** Auto, then one group per usable connection holding its models (or, with no model list, the connection itself). */
export function buildComboOptions(i: ComboBuildInput): ComboOption[] {
  const options: ComboOption[] = [{ id: AUTO_ID, label: "Auto", detail: i.autoDetail, leading: i.autoTone }];
  const seen = new Map<string, number>();
  for (const c of i.usable) {
    const current = i.overrideFor(c.id) || c.defaultModel;
    const ids = withCurrentFirst(modelIds(c, current), current);
    // Two connections can share a name; a group is a connection, so its heading must be distinct.
    const n = (seen.get(c.label) ?? 0) + 1;
    seen.set(c.label, n);
    const heading = n === 1 ? c.label : `${c.label} (${n})`;
    if (ids.length === 0) {
      options.push({ id: connectionOptionId(c.id), label: c.label, detail: i.rowDetail(c), leading: i.toneDot(c) });
      continue;
    }
    for (const model of ids) {
      options.push({
        id: modelOptionId(c.id, model),
        label: model,
        detail: model === current ? i.rowDetail(c) : undefined,
        group: heading,
        leading: i.toneDot(c),
      });
    }
  }
  return options;
}
