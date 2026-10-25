"use client";
import { useEffect, useState } from "react";
import { Plus, Trash2, Undo2 } from "lucide-react";
import { Badge, Button, EmptyState, Input, Kbd, KbdChord, ListRow, Notice, Panel, Segmented, SkeletonRows } from "@/components/ui";
import { appliedTheme, applyTheme, type Theme } from "@/lib/theme";

/** Catalogue: every component and state in the active theme. Toggle to see both. */
export default function DesignSystemCatalogue() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mode, setMode] = useState<"ask" | "auto" | "plan">("ask");
  useEffect(() => setTheme(appliedTheme()), []);

  return (
    <main className="min-h-screen overflow-y-auto bg-sub-000 p-6 text-ink" style={{ height: "100vh" }}>
      <header className="mb-6 flex items-center gap-4">
        <h1 className="t-display">Design system</h1>
        <Segmented
          label="Theme"
          value={theme}
          onChange={(t) => {
            setTheme(t);
            applyTheme(t);
          }}
          options={[{ value: "dark", label: "Graphite" }, { value: "light", label: "Ivory" }]}
        />
      </header>

      <div className="grid max-w-[960px] gap-6">
        <Panel title="Button" titleId="ds-button" bodyClassName="flex flex-wrap items-center gap-2 p-3">
          <Button variant="primary">Save</Button>
          <Button>Cancel</Button>
          <Button variant="ghost">Discard</Button>
          <Button variant="danger" icon={<Trash2 size={14} aria-hidden />}>Delete harness</Button>
          <Button variant="primary" loading>Saving</Button>
          <Button disabled>Run</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button iconOnly aria-label="Undo" variant="ghost" icon={<Undo2 size={14} aria-hidden />} />
          <Button icon={<Plus size={14} aria-hidden />}>New chat</Button>
        </Panel>

        <Panel title="Input" titleId="ds-input" bodyClassName="grid gap-3 p-3 sm:grid-cols-2">
          <Input label="Name" placeholder="Untitled harness" />
          <Input label="API key" mono hint="Stored in the backend process, never shown again." defaultValue="sk-or-…" />
          <Input label="Endpoint" error="Couldn't reach that address. Check it and try again." defaultValue="http://127.0.0.1:1" />
          <Input label="Disabled" disabled defaultValue="Fixed by vendor" />
        </Panel>

        <Panel title="Badge" titleId="ds-badge" bodyClassName="flex flex-wrap items-center gap-2 p-3">
          <Badge>Not connected</Badge>
          <Badge tone="signal">Connected</Badge>
          <Badge tone="warn">No model chosen</Badge>
          <Badge tone="fault">Key rejected</Badge>
          {(["agent", "gate", "hitl", "skill", "mcp", "tool", "decision"] as const).map((r) => (
            <Badge key={r} role={r}>{r}</Badge>
          ))}
        </Panel>

        <Panel title="List row" titleId="ds-row" bodyClassName="grid gap-1 p-2">
          <ListRow title="Anthropic" meta="claude-sonnet-5-5" selected trailing={<Badge tone="signal">Connected</Badge>} />
          <ListRow title="OpenAI" meta="not connected" />
          <ListRow title="Ollama local" meta="http://127.0.0.1:11434" disabled />
        </Panel>

        <Panel title="Notice, empty and loading" titleId="ds-state" bodyClassName="grid gap-3 p-3">
          <Notice tone="info" title="Saved on this device">Export an OHM file to share a copy.</Notice>
          <Notice tone="warn" title="No model chosen">This connection refuses a run without one.</Notice>
          <Notice tone="fault" title="Couldn't reach the local engine" action={<Button size="sm">Retry</Button>}>Saved harnesses can&apos;t be listed right now.</Notice>
          <EmptyState title="No chats yet" action={<Button icon={<Plus size={14} aria-hidden />}>New chat</Button>}>Start one and it shows up here.</EmptyState>
          <SkeletonRows rows={2} label="Loading chats" />
        </Panel>

        <Panel title="Segmented and keys" titleId="ds-seg" bodyClassName="flex flex-wrap items-center gap-4 p-3">
          <Segmented
            label="Permission mode"
            value={mode}
            onChange={setMode}
            options={[{ value: "ask", label: "Ask", hint: "Ask before every command" }, { value: "auto", label: "Auto" }, { value: "plan", label: "Plan" }]}
          />
          <KbdChord caps={["Ctrl", "K"]} />
          <Kbd>?</Kbd>
        </Panel>

        <Panel variant="float" title="Float" titleId="ds-float" bodyClassName="p-3">
          Sheets, menus and the command palette sit on a float: a value step, a line and the only shadow.
        </Panel>
      </div>
    </main>
  );
}
