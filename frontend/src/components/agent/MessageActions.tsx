"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useT } from "@/i18n/store";

export function MessageActions({ content, onReuse }: { content: string; onReuse?: () => void }) {
  const t = useT();
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
    <Button size="sm" variant="ghost" onClick={() => void copy()}>{t("chat.message.copy")}</Button>
    {onReuse && <Button size="sm" variant="ghost" onClick={onReuse}>{t("chat.message.reuse")}</Button>}
    {copied && <span role="status" className="text-meta text-ink-mute">{t("chat.message.copied")}</span>}
    {error && <span role="alert" className="text-meta text-fault-text">{t("chat.message.copyFailed")}</span>}
  </div>;
}
