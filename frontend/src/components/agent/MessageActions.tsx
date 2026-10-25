"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function MessageActions({ content, onReuse }: { content: string; onReuse?: () => void }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setError(false);
    } catch {
      setCopied(false);
      setError(true);
    }
  };
  return <div className="-ml-2 flex flex-wrap items-center gap-1">
    <Button size="sm" variant="ghost" onClick={() => void copy()}>Copy message</Button>
    {onReuse && <Button size="sm" variant="ghost" onClick={onReuse}>Reuse message</Button>}
    {copied && <span role="status" className="text-meta text-ink-mute">Copied</span>}
    {error && <span role="alert" className="text-meta text-fault-text">Could not copy. Select the message text and copy it manually.</span>}
  </div>;
}
