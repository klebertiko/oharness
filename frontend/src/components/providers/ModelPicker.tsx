"use client";

import { ChevronDown } from "lucide-react";

import { Combobox, type ComboOption } from "@/components/ui/Combobox";
import { specOf, type Connection, type ModelInfo } from "./providerStore";

const money = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);
const ctx = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k context` : n > 0 ? `${n} context` : "");

export function modelDetail(m: ModelInfo): string {
  return [m.via, ctx(m.ctx), m.size, m.price ? `${money(m.price[0])} → ${money(m.price[1])} / Mtok` : ""]
    .filter(Boolean)
    .join(" · ");
}

/** Where a connection's model list came from, said plainly. */
export function modelSourceNote(c: Connection): string {
  return c.modelsFromEndpoint
    ? `Served by ${c.endpoint || specOf(c).endpoint.default} at the last test.`
    : "From the OHarness catalog. Test the connection to list what it actually serves.";
}

/**
 * Model choice for one connection — the Providers default, the chat picker's
 * "choose a model" setup and a Studio node's model all use this, so the same
 * list, wording and states appear everywhere. Searchable, and any name can
 * be typed (a freshly pulled local model need not be listed yet).
 *
 * `inheritLabel` adds a first "" option meaning "don't pin; use the
 * connection's default" (Studio nodes).
 */
export function ModelPicker({
  connection,
  value,
  onChange,
  label = "Model",
  inheritLabel,
  inheritDetail,
  triggerClassName,
  describedBy,
  disabled,
}: {
  /** Null when nothing is pinned yet: only the inherit option and typed names. */
  connection: Connection | null;
  value: string;
  onChange: (model: string) => void;
  label?: string;
  inheritLabel?: string;
  inheritDetail?: string;
  triggerClassName?: string;
  describedBy?: string;
  disabled?: boolean;
}) {
  const options: ComboOption[] = (connection?.models ?? []).map((m) => ({ id: m.id, label: m.id, detail: modelDetail(m) }));
  if (inheritLabel !== undefined) options.unshift({ id: "", label: inheritLabel, detail: inheritDetail });
  // A saved value the list no longer contains still shows as the selection.
  if (value && !options.some((o) => o.id === value)) {
    options.push({ id: value, label: value, detail: "Not in the current list" });
  }

  const shown = value || inheritLabel || "None chosen";
  return (
    <Combobox
      label={label}
      triggerLabel={`${label}: ${shown}`}
      describedBy={describedBy}
      value={value}
      options={options}
      onChange={onChange}
      searchable
      allowCustom
      searchPlaceholder="Filter or type a model name"
      status={connection?.health === "probing" ? "loading" : "ready"}
      loadingText="Testing the connection…"
      emptyText="No models listed. Test the connection, or type a model name."
      header={connection ? modelSourceNote(connection) : "Pin a connection to list its models. A typed name is sent as is."}
      width={340}
      disabled={disabled}
      triggerClassName={
        triggerClassName ??
        "t-body h-8 w-full justify-between border border-line bg-sub-200 px-2 text-left text-ink focus-visible:border-signal-deep"
      }
      trigger={
        <>
          <span className={`min-w-0 truncate ${value ? "t-meta text-ink" : "text-ink-mute"}`}>{shown}</span>
          <ChevronDown size={13} strokeWidth={1.8} className="flex-none text-ink-mute" aria-hidden />
        </>
      }
    />
  );
}
