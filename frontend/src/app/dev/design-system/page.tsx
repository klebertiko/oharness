"use client";
import { useEffect, useState } from "react";
import { Plus, Trash2, Undo2 } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Kbd,
  KbdChord,
  ListRow,
  Menu,
  Notice,
  Panel,
  Popover,
  Segmented,
  Select,
  Sheet,
  Skeleton,
  SkeletonRows,
  SkeletonText,
  StatusMark,
  Switch,
  Tabs,
  Textarea,
  ToastProvider,
  Tooltip,
  useToast,
} from "@/components/ui";
import { useT } from "@/i18n/store";
import { appliedTheme, applyTheme, type Theme } from "@/lib/theme";

type Density = "comfortable" | "compact";

/** Every primitive, in every state, in the active theme and density. */
export default function DesignSystemCatalogue() {
  return (
    <ToastProvider>
      <Catalogue />
    </ToastProvider>
  );
}

function Catalogue() {
  const t = useT();
  const push = useToast();
  const [theme, setTheme] = useState<Theme>("system");
  const [density, setDensity] = useState<Density>("comfortable");
  const [mode, setMode] = useState<"ask" | "auto" | "plan">("ask");
  const [tab, setTab] = useState("one");
  const [choice, setChoice] = useState("alpha");
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [combo, setCombo] = useState<string | null>("alpha");
  const [transcript, setTranscript] = useState(15);

  useEffect(() => setTheme(appliedTheme()), []);
  useEffect(() => {
    document.documentElement.dataset.density = density;
    document.documentElement.style.setProperty("--transcript-size", `${transcript}px`);
  }, [density, transcript]);

  return (
    <main className="min-h-screen overflow-y-auto bg-bg-app p-(--pad-6) text-fg-1" style={{ height: "100vh" }}>
      <header className="mb-(--gap-4) flex flex-wrap items-center gap-(--gap-3)">
        <h1 className="t-display">{t("ds.catalogue")}</h1>
        <Segmented
          label={t("ds.theme")}
          value={theme}
          onChange={(next) => {
            setTheme(next);
            applyTheme(next);
          }}
          options={[
            { value: "system", label: t("ds.system") },
            { value: "dark", label: t("ds.graphite") },
            { value: "light", label: t("ds.ivory") },
          ]}
        />
        <Segmented
          label={t("ds.density")}
          value={density}
          onChange={setDensity}
          options={[
            { value: "comfortable", label: t("ds.comfortable") },
            { value: "compact", label: t("ds.compact") },
          ]}
        />
      </header>

      <div className="grid max-w-[960px] gap-(--gap-4)">
        <Panel title="Button" titleId="ds-button" bodyClassName="flex flex-wrap items-center gap-(--gap-2) p-(--pad-3)">
          <Button variant="primary">Save</Button>
          <Button>Cancel</Button>
          <Button variant="ghost">Discard</Button>
          <Button variant="danger" icon={<Trash2 className="size-(--icon)" aria-hidden />}>Delete harness</Button>
          <Button variant="primary" loading>Saving</Button>
          <Button disabled>Run</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button icon={<Plus className="size-(--icon)" aria-hidden />}>New chat</Button>
        </Panel>

        <Panel title="Icon button" titleId="ds-icon" bodyClassName="flex flex-wrap items-center gap-(--gap-2) p-(--pad-3)">
          <Tooltip label="Undo">
            <IconButton label="Undo" variant="ghost" icon={<Undo2 className="size-(--icon)" aria-hidden />} />
          </Tooltip>
          <IconButton label="Add" variant="primary" icon={<Plus className="size-(--icon)" aria-hidden />} />
          <IconButton label="Delete" variant="danger" icon={<Trash2 className="size-(--icon)" aria-hidden />} />
          <IconButton label="Busy" loading icon={<Undo2 className="size-(--icon)" aria-hidden />} />
          <IconButton label="Off" disabled icon={<Undo2 className="size-(--icon)" aria-hidden />} />
          <IconButton label="Small undo" size="sm" icon={<Undo2 className="size-(--icon)" aria-hidden />} />
          <IconButton label="Large undo" size="lg" icon={<Undo2 className="size-(--icon)" aria-hidden />} />
        </Panel>

        <Panel title="Input and textarea" titleId="ds-input" bodyClassName="grid gap-(--gap-3) p-(--pad-3) sm:grid-cols-2">
          <Input label="Name" placeholder="Untitled harness" />
          <Input label="API key" mono hint="Stored in the backend process, never shown again." defaultValue="sk-or-…" />
          <Input label="Endpoint" error="Couldn't reach that address. Check it and try again." defaultValue="http://127.0.0.1:1" />
          <Input label="Disabled" disabled defaultValue="Fixed by vendor" />
          <Textarea label="Notes" hint="One sentence on what changed." defaultValue="Warm graphite, one type scale." />
          <Textarea label="Rejected" error="That note is empty. Write what changed." defaultValue="" />
          <Textarea label="Locked" disabled defaultValue="Set by the harness." />
        </Panel>

        <Panel title="Select, checkbox and switch" titleId="ds-choice" bodyClassName="grid gap-(--gap-3) p-(--pad-3)">
          <Select
            label="Model"
            value={choice}
            onChange={setChoice}
            hint="The connection uses this model."
            options={[
              { value: "alpha", label: "Alpha" },
              { value: "bravo", label: "Bravo", disabled: true },
              { value: "charlie", label: "Charlie" },
            ]}
          />
          <Select label="Unavailable" value="alpha" onChange={() => {}} disabled error="No model is published yet." options={[{ value: "alpha", label: "Alpha" }]} />
          <div className="flex flex-wrap items-center gap-(--gap-4)">
            <Checkbox label="Unchecked" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
            <Checkbox label="Checked" defaultChecked />
            <Checkbox label="Mixed" indeterminate />
            <Checkbox label="Disabled" disabled />
            <Switch label={on ? t("ui.on") : t("ui.off")} checked={on} onCheckedChange={setOn} />
            <Switch label="Locked" checked={false} disabled onCheckedChange={() => {}} />
          </div>
        </Panel>

        <Panel title="Combobox, menu, tooltip and popover" titleId="ds-pop" bodyClassName="flex flex-wrap items-start gap-(--gap-3) p-(--pad-3)">
          <Combobox
            label="Letter"
            triggerLabel={`Letter: ${combo ?? "none"}`}
            value={combo}
            onChange={setCombo}
            trigger={<span className="t-ui">{combo}</span>}
            options={[
              { id: "alpha", label: "Alpha" },
              { id: "bravo", label: "Bravo", disabled: true },
              { id: "charlie", label: "Charlie" },
            ]}
          />
          <Menu
            label="Actions"
            items={[
              { id: "rename", label: "Rename", shortcut: "F2", onSelect: () => {} },
              { id: "disabled", label: "Archive", disabled: true },
              {
                id: "move",
                label: "Move",
                items: [
                  { id: "inbox", label: "Inbox", onSelect: () => {} },
                  { id: "later", label: "Later", onSelect: () => {} },
                ],
              },
            ]}
          />
          <Popover label="About this row" trigger={<span className="t-ui">Details</span>}>
            <p className="t-body text-fg-2">The row keeps its place. This panel does not trap the page.</p>
          </Popover>
        </Panel>

        <Panel title="Tabs, segmented and keys" titleId="ds-tabs" bodyClassName="grid gap-(--gap-3) p-(--pad-3)">
          <Tabs
            label="Sections"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "one", label: "Overview", content: "The overview is the first panel." },
              { value: "two", label: "Activity", content: "Activity lists the runs." },
              { value: "three", label: "Locked", content: "Hidden", disabled: true },
            ]}
          />
          <div className="flex flex-wrap items-center gap-(--gap-4)">
            <Segmented
              label="Permission mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: "ask", label: "Ask", hint: "Ask before every command" },
                { value: "auto", label: "Auto" },
                { value: "plan", label: "Plan", disabled: true },
              ]}
            />
            <KbdChord caps={["Ctrl", "K"]} />
            <Kbd>?</Kbd>
          </div>
        </Panel>

        <Panel title="Dialog and sheet" titleId="ds-dialog" bodyClassName="flex flex-wrap gap-(--gap-2) p-(--pad-3)">
          <Button onClick={() => setDialog(true)}>Open dialog</Button>
          <Button onClick={() => setSheet(true)}>Open sheet</Button>
          <Dialog title="Rename harness" description="The name is what the list shows." open={dialog} onOpenChange={setDialog}>
            <Input label="Name" defaultValue="Agile harness" />
          </Dialog>
          <Sheet title="Keyboard map" open={sheet} onOpenChange={setSheet} showClose>
            <p className="t-body p-(--pad-3) text-fg-2">The sheet traps focus and returns it here.</p>
          </Sheet>
        </Panel>

        <Panel title="Notice, toast, empty and error" titleId="ds-state" bodyClassName="grid gap-(--gap-3) p-(--pad-3)">
          <Notice tone="info" title="Saved on this device">Export an OHM file to share a copy.</Notice>
          <Notice tone="warn" title="No model chosen">This connection refuses a run without one.</Notice>
          <Notice tone="fault" title="Couldn't reach the local engine" action={<Button size="sm">{t("ui.retry")}</Button>}>
            Saved harnesses can&apos;t be listed right now.
          </Notice>
          <div className="flex flex-wrap gap-(--gap-2)">
            <Button size="sm" onClick={() => push({ title: "Saved", body: "The harness is on this device.", tone: "info" })}>Info toast</Button>
            <Button size="sm" onClick={() => push({ title: "No model", body: "Pick one before the run.", tone: "warn" })}>Warn toast</Button>
            <Button size="sm" variant="danger" onClick={() => push({ title: "The sidecar did not answer", body: "The list stays as it was.", tone: "fault" })}>Fault toast</Button>
          </div>
          <EmptyState title="No chats yet" icon={<Plus className="size-(--icon)" aria-hidden />} action={<Button icon={<Plus className="size-(--icon)" aria-hidden />}>New chat</Button>}>
            Start one and it shows up here.
          </EmptyState>
          <ErrorState
            title="Couldn't load chats"
            reason="The sidecar did not answer."
            diagnostic="timeout after 5s · sidecar"
            onRetry={() => {}}
          />
        </Panel>

        <Panel title="Skeleton, badge and status" titleId="ds-skel" bodyClassName="grid gap-(--gap-3) p-(--pad-3)">
          <SkeletonText lines={2} />
          <Skeleton className="h-control-md w-40" />
          <SkeletonRows rows={2} label="Loading chats" />
          <div className="flex flex-wrap items-center gap-(--gap-2)">
            <Badge>Not connected</Badge>
            <Badge tone="signal">Connected</Badge>
            <Badge tone="warn">No model chosen</Badge>
            <Badge tone="fault">Key rejected</Badge>
            {(["agent", "gate", "hitl", "skill", "mcp", "tool", "decision"] as const).map((role) => (
              <Badge key={role} role={role}>{role}</Badge>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-(--gap-3)">
            {(["ok", "warn", "fault", "busy", "idle", "off"] as const).map((tone) => (
              <span key={tone} className="inline-flex items-center gap-(--gap-1) t-meta text-fg-2">
                <StatusMark tone={tone} />
                {tone}
              </span>
            ))}
          </div>
        </Panel>

        <Panel title="List row" titleId="ds-row" bodyClassName="grid gap-(--gap-1) p-(--pad-2)">
          <ListRow title="Anthropic" meta="claude-sonnet-5-5" selected trailing={<Badge tone="signal">Connected</Badge>} />
          <ListRow title="OpenAI" description="Not connected. Add a key to use it." />
          <ListRow title="Ollama local" meta="http://127.0.0.1:11434" disabled />
        </Panel>

        <Panel title="Transcript size" titleId="ds-type" bodyClassName="grid gap-(--gap-2) p-(--pad-3)">
          <div className="flex items-center gap-(--gap-2)">
            <Button size="sm" onClick={() => setTranscript((size) => Math.max(12, size - 1))}>Smaller</Button>
            <span className="t-ui text-fg-2">Transcript {transcript}px</span>
            <Button size="sm" onClick={() => setTranscript((size) => Math.min(20, size + 1))}>Larger</Button>
          </div>
          <p className="t-transcript max-w-[68ch] text-fg-1">The conversation uses this size. It stays between 12 and 20.</p>
          <p className="t-display">Display</p>
          <p className="t-title">Title</p>
          <p className="t-heading">Heading</p>
          <p className="t-body">Body</p>
          <p className="t-ui">Interface</p>
          <p className="t-meta">Meta</p>
          <p className="t-caption">Caption</p>
          <p className="t-code">code</p>
        </Panel>

        <Panel variant="float" title="Float" titleId="ds-float" bodyClassName="p-(--pad-3)">
          Sheets, menus and the command palette sit on a float: a value step, a line and the only shadow.
        </Panel>
        <Panel variant="inset" title="Inset" titleId="ds-inset" bodyClassName="p-(--pad-3)">
          An inset is a contained surface, one step down from the pane.
        </Panel>
        <Panel variant="dock" title="Dock" titleId="ds-dock" bodyClassName="p-(--pad-3)">
          A docked column has the header and no second frame.
        </Panel>
      </div>
    </main>
  );
}
