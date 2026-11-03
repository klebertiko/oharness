/**
 * The chat harness selector's list (ADR 0012): identity and purpose only —
 * never a provider, model or connection. "No harness" always leads.
 */
import type { ComboOption } from "@/components/ui/Combobox";
import { splitHarnessName } from "@/components/harnesses/harnessLabel";
import { tr } from "@/i18n/store";
import type { HarnessStatus } from "./chatHarness";

/** Options (counting "No harness") from which a filter box is worth its row. */
export const SEARCH_FROM = 8;
/** Harnesses from which "Recent" is worth its heading; below this the list is short enough to scan. */
export const RECENT_FROM = 6;
const RECENT_MAX = 3;

export const NONE_ID = "";

export interface HarnessChoice {
  id: string;
  name: string;
  isDefault: boolean;
  /** Saved in Studio, imported or bundled; drives the fallback line under a harness with no description. */
  source?: "bundled" | "saved" | "imported";
  description?: string;
}

/** First sentence of the purpose, trimmed to one line. */
function purpose(description: string | undefined, fallback: string): string {
  const first = description?.trim().split(/(?<=[.!?])\s/)[0] ?? "";
  if (!first) return fallback;
  return first.length > 80 ? `${first.slice(0, 79)}…` : first;
}

export function buildHarnessOptions({
  entries,
  status,
  recent,
  studioActive,
}: {
  entries: HarnessChoice[];
  status: HarnessStatus;
  recent: string[];
  studioActive: { id: string; name: string } | null;
}): { options: ComboOption[]; searchable: boolean; harnessCount: number } {
  const option = (e: HarnessChoice, group: string): ComboOption => ({
    id: e.id,
    label: splitHarnessName(e.name).title,
    detail: purpose(e.description, tr(e.isDefault ? "harness.detail.bundled" : e.source === "saved" ? "harness.detail.saved" : "harness.detail.imported")),
    group,
  });

  const mine = entries.filter((e) => !e.isDefault);
  const bundled = entries.filter((e) => e.isDefault);
  const fromStudio: ComboOption[] =
    studioActive && !entries.some((e) => e.id === studioActive.id)
      ? [{ id: studioActive.id, label: splitHarnessName(studioActive.name).title, detail: tr("harness.detail.studio"), group: tr("harness.group.mine") }]
      : [];

  const options: ComboOption[] = [{ id: NONE_ID, label: tr("harness.none"), detail: tr("harness.none.detail") }];
  if (status.state === "missing") {
    options.push({ id: status.id, label: splitHarnessName(status.name).title, detail: tr("harness.detail.gone"), group: tr("harness.group.unavailable"), disabled: true });
  }

  const harnessCount = entries.length + fromStudio.length;
  const known = new Map(entries.map((e) => [e.id, e]));
  const recents =
    harnessCount >= RECENT_FROM ? recent.filter((id) => known.has(id)).slice(0, RECENT_MAX) : [];
  for (const id of recents) options.push(option(known.get(id)!, tr("harness.group.recent")));

  const rest = (list: HarnessChoice[]) => list.filter((e) => !recents.includes(e.id));
  options.push(...rest(mine).map((e) => option(e, tr("harness.group.mine"))), ...fromStudio, ...rest(bundled).map((e) => option(e, tr("harness.group.bundled"))));

  return { options, searchable: options.length >= SEARCH_FROM, harnessCount };
}
