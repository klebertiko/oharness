"use client";
import { Button } from "@/components/ui";
import { tr } from "@/i18n/store";

/** The one ask before a proposal takes effect. Remember stores it. Not now leaves it out. */
export function MemoryProposalChip({
  text,
  onRemember,
  onDismiss,
}: {
  text: string;
  onRemember: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-control border border-line-soft bg-sub-100 px-2 py-2" role="group" aria-label={tr("nilo.memory.ask")}>
      <p className="m-0 text-body text-ink">{tr("nilo.memory.ask")}</p>
      <p className="m-0 min-w-0 flex-1 text-body text-ink-dim">{text}</p>
      <Button type="button" size="sm" variant="primary" onClick={onRemember}>
        {tr("nilo.memory.remember")}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
        {tr("nilo.memory.notNow")}
      </Button>
    </div>
  );
}
