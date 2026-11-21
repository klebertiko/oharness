"use client";
import { useState } from "react";
import { Button, Notice } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import { Board } from "./Board";
import { ForjaImprovements } from "./ForjaImprovements";
import { ForjaInbox } from "./ForjaInbox";
import { ForjaMetrics } from "./ForjaMetrics";
import { ForjaSetup } from "./ForjaSetup";
import { ItemSheet } from "./ItemSheet";

type Tab = "board" | "inbox" | "metrics" | "improvements" | "setup";

/**
 * The Forja destination (ADR 0058): the work items as a board, what waits for a person, how the Forja is set up and how it is doing.
 * Everything is local; nothing leaves the machine. A drag only moves a card when the blueprint allows it; otherwise it says why.
 */
export function ForjaScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("board");
  const [openId, setOpenId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  const sections: { id: Tab; label: string }[] = [
    { id: "inbox", label: t("forja.tab.inbox") },
    { id: "board", label: t("forja.tab.board") },
    { id: "metrics", label: t("forja.tab.metrics") },
    { id: "improvements", label: t("forja.nav.improvements") },
    { id: "setup", label: t("forja.tab.setup") },
  ];
  return (
    <div className="@container flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      <h1 className="sr-only">{t("forja.screen")}</h1>
      <Notice tone="warn" className="m-3 mb-0" title={t("forja.runner.title")}>{t("forja.runner.body")}</Notice>
      <nav aria-label={t("forja.tabs")} className="flex flex-wrap gap-1 border-b border-line-soft px-3 py-2">
        {sections.map((section) => (
          <Button key={section.id} size="sm" variant={tab === section.id ? "primary" : "ghost"} aria-current={tab === section.id ? "page" : undefined} onClick={() => setTab(section.id)}>
            {section.label}
          </Button>
        ))}
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {tab === "board" && <Board key={version} onOpen={setOpenId} />}
        {tab === "inbox" && <ForjaInbox key={version} onOpen={setOpenId} />}
        {tab === "improvements" && <ForjaImprovements />}
        {tab === "setup" && <ForjaSetup />}
        {tab === "metrics" && <ForjaMetrics />}
      </div>
      {openId && <ItemSheet id={openId} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </div>
  );
}
