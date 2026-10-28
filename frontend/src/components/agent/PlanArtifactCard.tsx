"use client";
import { Button, Notice } from "@/components/ui";

interface Props {
  text: string;
  busy?: boolean;
  error?: string | null;
  onApprove: () => void;
  onDiscard: () => void;
}

/** The plan a Plan-mode turn ended in. Nothing has run; approving is what lets the conversation execute. */
export function PlanArtifactCard({ text, busy, error, onApprove, onDiscard }: Props) {
  return (
    <section aria-label="Plan awaiting your approval" className="flex flex-col gap-3 rounded-control border border-line-strong bg-sub-100 p-4">
      <p className="text-body font-medium text-ink-mute">Plan · Nothing has run yet</p>
      <div className="max-w-[68ch] whitespace-pre-wrap text-reading text-ink wrap-anywhere">{text}</div>
      {error && <Notice tone="fault">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy} onClick={onApprove}>Approve plan</Button>
        <Button disabled={busy} onClick={onDiscard}>Discard plan</Button>
      </div>
      <p className="text-meta text-ink-mute">Approving moves this chat to Ask and sends the plan as the next turn. Commands still wait for your approval.</p>
    </section>
  );
}
