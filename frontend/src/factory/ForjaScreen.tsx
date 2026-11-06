"use client";
import { useState } from "react";
import { Segmented } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import { Board } from "./Board";
import { ForjaInbox } from "./ForjaInbox";
import { ForjaMetrics } from "./ForjaMetrics";
import { ForjaSetup } from "./ForjaSetup";
import { ItemSheet } from "./ItemSheet";

type Tab = "board" | "inbox" | "setup" | "metrics";

/**
 * The Forja destination (ADR 0058): the work items as a board, what waits for a person, how the Forja is set up and how it is doing.
 * Everything is local; nothing leaves the machine. Moving an item is an action with a checkpoint, never a drag.
 */
export function ForjaScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("board");
  const [openId, setOpenId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <h1 className="sr-only">{t("forja.screen")}</h1>
      <div className="flex-none border-b border-line-soft px-3 py-2">
        <Segmented
          label={t("forja.tabs")}
          value={tab}
          onChange={setTab}
          options={[
            { value: "board", label: t("forja.tab.board") },
            { value: "inbox", label: t("forja.tab.inbox") },
            { value: "setup", label: t("forja.tab.setup") },
            { value: "metrics", label: t("forja.tab.metrics") },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "board" && <Board key={version} onOpen={setOpenId} />}
        {tab === "inbox" && <ForjaInbox key={version} onOpen={setOpenId} />}
        {tab === "setup" && <ForjaSetup />}
        {tab === "metrics" && <ForjaMetrics />}
      </div>
      {openId && <ItemSheet id={openId} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </div>
  );
}
