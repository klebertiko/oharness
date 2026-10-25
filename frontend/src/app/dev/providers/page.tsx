"use client";
import { useMemo, useState } from "react";
import { Activity, KeyRound, Plug, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Panel } from "@/components/shell/Panel";
import type { Command } from "@/components/shell/commands";
import { PROVIDERS_PANEL_TITLE } from "@/components/providers/copy";
import { ProvidersList } from "@/components/providers/ProvidersList";
import { Dossier } from "@/components/providers/Dossier";
import { RunBinding } from "@/components/providers/RunBinding";
import { useProviderStore, specOf } from "@/components/providers/providerStore";
import { activeVault, VAULT_LABEL } from "@/components/providers/secrets";

/**
 * Development mount for the provider workstream.
 *
 * The real app reaches this surface through the rail's Providers section; this
 * route exists so the panels can be exercised — and screenshotted — without
 * standing up the canvas or the FastAPI backend.
 */
export default function ProvidersDevPage() {
  const [name, setName] = useState("triage-loop");
  const { connections, selectedId, probe, select } = useProviderStore();

  const live = connections.filter((c) => c.health === "live").length;

  const commands: Command[] = useMemo(
    () => [
      {
        id: "prov.test",
        label: "Test selected connection",
        group: "Providers",
        icon: Activity,
        chord: "Mod+T",
        meta: selectedId,
        run: () => void probe(selectedId),
      },
      {
        id: "prov.testall",
        label: "Test every connection",
        group: "Providers",
        icon: Plug,
        meta: `${connections.length} rows`,
        run: () => connections.forEach((c) => void probe(c.id)),
      },
      ...connections.map((c) => ({
        id: `prov.open.${c.id}`,
        label: `Open ${c.label}`,
        group: "Providers",
        icon: KeyRound,
        meta: specOf(c).monogram,
        keywords: specOf(c).vendor,
        run: () => select(c.id),
      })),
    ],
    [connections, probe, select, selectedId]
  );

  const vault = activeVault();

  return (
    <AppShell
      commands={commands}
      harnessName={name}
      onHarnessNameChange={setName}
      mode="draft"
      running={false}
      nodeCount={connections.length}
      edgeCount={live}
      selectedId={selectedId}
      backendOk
      toolbar={null}
      left={
        <Panel title={PROVIDERS_PANEL_TITLE} meta={`${connections.length}`}>
          <ProvidersList />
        </Panel>
      }
      stage={<Dossier />}
      right={
        <Panel
          title="Run binding"
          meta={name}
          actions={
            <span
              className="t-meta flex items-center gap-1 text-ink-mute"
              title={`Credentials are held in the ${VAULT_LABEL[vault]}`}
            >
              <ShieldCheck size={11} strokeWidth={1.8} />
              {VAULT_LABEL[vault]}
            </span>
          }
        >
          <RunBinding />
        </Panel>
      }
    />
  );
}
