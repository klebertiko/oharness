"use client";
import { useState } from "react";
import { Button } from "@/components/ui";
import { tr } from "@/i18n/store";

/** Edit, send, or discard. Sending is the person's button. Editing clears a previous approval. */
export function DraftCard({
  body,
  approved,
  onEdit,
  onSend,
  onDiscard,
}: {
  body: string;
  approved: boolean;
  onEdit: (body: string) => void;
  onSend: () => void;
  onDiscard: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(body);
  return (
    <article className="flex flex-col gap-2 rounded-panel border border-line-soft bg-sub-100 p-3">
      <p className="m-0 text-meta text-ink-dim">{tr("nilo.drafts.pending")}</p>
      {editing ? (
        <textarea className="min-h-16 rounded-control border border-line-strong bg-sub-000 p-2 text-body" value={text} onChange={(event) => setText(event.target.value)} aria-label={tr("nilo.drafts.edit")} />
      ) : (
        <p className="m-0 text-body text-ink">{text}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            if (editing) onEdit(text);
            setEditing((value) => !value);
          }}
        >
          {tr("nilo.drafts.edit")}
        </Button>
        <Button type="button" size="sm" variant="primary" disabled={!approved || editing} onClick={onSend}>
          {tr("nilo.drafts.send")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDiscard}>
          {tr("nilo.drafts.discard")}
        </Button>
      </div>
    </article>
  );
}
