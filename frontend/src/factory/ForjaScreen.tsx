"use client";
import { useEffect, useState } from "react";
import { Button, Notice } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import { Board } from "./Board";
import { ForjaBlueprint } from "./ForjaBlueprint";
import { ForjaImprovements } from "./ForjaImprovements";
import { ForjaInbox } from "./ForjaInbox";
import { ForjaMetrics } from "./ForjaMetrics";
import { ForjaRuns } from "./ForjaRuns";
import { ForjaSetup } from "./ForjaSetup";
import { forjaApi, type RunBoard } from "./forjaApi";
import { ItemSheet } from "./ItemSheet";
import type { NetworkStatus } from "./types";

type Tab = "board" | "inbox" | "runs" | "blueprint" | "metrics" | "improvements" | "setup";

/**
 * The Forja destination (ADR 0058): the work items as a board, what waits for a person, how the Forja is set up and how it is doing.
 * A drag only moves a card when the blueprint allows it; otherwise it says why.
 */
export function ForjaScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("board");
  const [openId, setOpenId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [runs, setRuns] = useState<RunBoard | null>(null);
  const [network, setNetwork] = useState<NetworkStatus | null>(null);
  const [loopState, setLoopState] = useState<"unknown" | "ready" | "off">("unknown");
  const refresh = () => setVersion((v) => v + 1);
  useEffect(() => {
    let gone = false;
    forjaApi.networkStatus().then((body) => { if (!gone) setNetwork(body); }).catch(() => { if (!gone) setNetwork(null); });
    return () => { gone = true; };
  }, []);
  useEffect(() => {
    let gone = false;
    let inFlight = false;
    const loadRuns = async () => {
      if (gone || inFlight) return;
      inFlight = true;
      try {
        const body = await forjaApi.runs();
        if (gone) return;
        setRuns(body);
        setLoopState("ready");
      } catch {
        if (gone) return;
        setRuns(null);
        setLoopState("off");
      } finally {
        inFlight = false;
      }
    };
    void loadRuns();
    const timer = window.setInterval(() => void loadRuns(), 1500);
    return () => { gone = true; window.clearInterval(timer); };
  }, [version]);
  const live = runs?.runs.find((run) => run.item_id === openId && (run.status === "running" || run.status === "starting")) ?? null;

  const sections: { id: Tab; label: string }[] = [
    { id: "inbox", label: t("forja.tab.inbox") },
    { id: "board", label: t("forja.tab.board") },
    { id: "runs", label: t("forja.tab.runs") },
    { id: "blueprint", label: t("forja.nav.blueprint") },
    { id: "metrics", label: t("forja.tab.metrics") },
    { id: "improvements", label: t("forja.nav.improvements") },
    { id: "setup", label: t("forja.tab.setup") },
  ];
  return (
    <div className="@container flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      <h1 className="sr-only">{t("forja.screen")}</h1>
      {network?.mode === "supervised" && <Notice tone="warn" className="m-3 mb-0" title={t("forja.network.supervised")}>{t(network.isolation === "none" ? "forja.network.noIsolation" : "forja.network.supervisedBody")}</Notice>}
      {loopState === "off" && <Notice tone="warn" className="m-3 mb-0" title={t("forja.runner.title")}>{t("forja.runner.body")}</Notice>}
      <nav aria-label={t("forja.tabs")} className="flex flex-wrap gap-1 border-b border-line-soft px-3 py-2">
        {sections.map((section) => (
          <Button key={section.id} size="sm" variant={tab === section.id ? "primary" : "ghost"} aria-current={tab === section.id ? "page" : undefined} onClick={() => setTab(section.id)}>
            {section.label}
          </Button>
        ))}
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {tab === "board" && <Board key={version} onOpen={setOpenId} />}
        {tab === "runs" && loopState === "ready" && runs && <ForjaRuns board={runs} onChanged={refresh} />}
        {tab === "runs" && loopState === "off" && <Notice tone="warn" className="m-3" title={t("forja.runner.title")}>{t("forja.runner.body")}</Notice>}
        {tab === "runs" && loopState === "unknown" && <p className="p-3 text-ink-mute">{t("forja.loading")}</p>}
        {tab === "blueprint" && <ForjaBlueprint />}
        {tab === "inbox" && <ForjaInbox key={version} onOpen={setOpenId} />}
        {tab === "improvements" && <ForjaImprovements />}
        {tab === "setup" && <ForjaSetup />}
        {tab === "metrics" && <ForjaMetrics />}
      </div>
      {openId && <ItemSheet id={openId} live={live} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </div>
  );
}
