"use client";
import { X } from "lucide-react";
import { Button } from "@/components/ui";
import type { QueuedMessage } from "@/store/messageQueueStore";

interface Props {
  items: QueuedMessage[];
  /** The turn stopped or failed: nothing runs on its own until a person says so. */
  paused: boolean;
  onRemove: (id: string) => void;
  onClear: () => void;
  onSendNext: () => void;
}

/** Messages waiting behind the current turn, in the order they will run. */
export function QueuedMessages({ items, paused, onRemove, onClear, onSendNext }: Props) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Queued messages" className="mb-2 rounded-control border border-line-soft bg-sub-100 px-3 py-2">
      <p className="flex flex-wrap items-center gap-2 text-meta text-ink-mute">
        <span>{paused ? `Queue paused: the turn did not finish. ${items.length} waiting.` : `Queued (${items.length}): runs after the current turn.`}</span>
        <span className="flex-1" />
        {paused && <Button size="sm" onClick={onSendNext}>Send next</Button>}
        <Button size="sm" onClick={onClear}>Clear queue</Button>
      </p>
      <ol aria-live="polite" className="mt-1 flex flex-col">
        {items.map((item) => (
          <li key={item.id} className="flex min-h-control-md items-center gap-2 text-body text-ink-dim">
            <span className="min-w-0 flex-1 truncate">{item.text}</span>
            <Button iconOnly size="sm" variant="ghost" aria-label={`Remove queued message: ${item.text.slice(0, 40)}`} title="Remove" onClick={() => onRemove(item.id)}
              icon={<X size={12} strokeWidth={2} aria-hidden />} />
          </li>
        ))}
      </ol>
    </section>
  );
}
