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
        <Panel title={t("ds.c.button")} titleId="ds-button" bodyClassName="flex flex-wrap items-center gap-(--gap-2) p-(--pad-3)">
          <Button variant="primary">{t("ds.c.save")}</Button>
          <Button>{t("ds.c.cancel")}</Button>
          <Button variant="ghost">{t("ds.c.discard")}</Button>
          <Button variant="danger" icon={<Trash2 className="size-(--icon)" aria-hidden />}>{t("ds.c.deleteHarness")}</Button>
          <Button variant="primary" loading>{t("ds.c.saving")}</Button>
          <Button disabled>{t("ds.c.run")}</Button>
          <Button size="sm">{t("ds.c.small")}</Button>
          <Button size="lg">{t("ds.c.large")}</Button>
          <Button icon={<Plus className="size-(--icon)" aria-hidden />}>{t("ds.c.newChat")}</Button>
        </Panel>

        <Panel title={t("ds.c.iconButton")} titleId="ds-icon" bodyClassName="flex flex-wrap items-center gap-(--gap-2) p-(--pad-3)">
          <Tooltip label={t("ds.c.undo")}>
            <IconButton label={t("ds.c.undo")} variant="ghost" icon={<Undo2 className="size-(--icon)" aria-hidden />} />
          </Tooltip>
          <IconButton label={t("ds.c.add")} variant="primary" icon={<Plus className="size-(--icon)" aria-hidden />} />
          <IconButton label={t("ds.c.delete")} variant="danger" icon={<Trash2 className="size-(--icon)" aria-hidden />} />
          <IconButton label={t("ds.c.busy")} loading icon={<Undo2 className="size-(--icon)" aria-hidden />} />
          <IconButton label={t("ds.c.off")} disabled icon={<Undo2 className="size-(--icon)" aria-hidden />} />
          <IconButton label={t("ds.c.smallUndo")} size="sm" icon={<Undo2 className="size-(--icon)" aria-hidden />} />
          <IconButton label={t("ds.c.largeUndo")} size="lg" icon={<Undo2 className="size-(--icon)" aria-hidden />} />
        </Panel>

        <Panel title={t("ds.c.inputAndTextarea")} titleId="ds-input" bodyClassName="grid gap-(--gap-3) p-(--pad-3) sm:grid-cols-2">
          <Input label={t("ds.c.name")} placeholder={t("ds.c.untitledHarness")} />
          <Input label={t("ds.c.apiKey")} mono hint={t("ds.c.storedInTheBackendProcessNever")} defaultValue="sk-or-…" />
          <Input label={t("ds.c.endpoint")} error={t("ds.c.couldntReachThatAddressCheckIt")} defaultValue="http://127.0.0.1:1" />
          <Input label={t("ds.c.disabled")} disabled defaultValue={t("ds.c.fixedByVendor")} />
          <Textarea label={t("ds.c.notes")} hint={t("ds.c.oneSentenceOnWhatChanged")} defaultValue={t("ds.c.warmGraphiteOneTypeScale")} />
          <Textarea label={t("ds.c.rejected")} error={t("ds.c.thatNoteIsEmptyWriteWhat")} defaultValue="" />
          <Textarea label={t("ds.c.locked")} disabled defaultValue={t("ds.c.setByTheHarness")} />
        </Panel>

        <Panel title={t("ds.c.selectCheckboxAndSwitch")} titleId="ds-choice" bodyClassName="grid gap-(--gap-3) p-(--pad-3)">
          <Select
            label={t("ds.c.model")}
            value={choice}
            onChange={setChoice}
            hint={t("ds.c.theConnectionUsesThisModel")}
            options={[
              { value: "alpha", label: "Alpha" },
              { value: "bravo", label: "Bravo", disabled: true },
              { value: "charlie", label: "Charlie" },
            ]}
          />
          <Select label={t("ds.c.unavailable")} value="alpha" onChange={() => {}} disabled error={t("ds.c.noModelIsPublishedYet")} options={[{ value: "alpha", label: "Alpha" }]} />
          <div className="flex flex-wrap items-center gap-(--gap-4)">
            <Checkbox label={t("ds.c.unchecked")} checked={checked} onChange={(event) => setChecked(event.target.checked)} />
            <Checkbox label={t("ds.c.checked")} defaultChecked />
            <Checkbox label={t("ds.c.mixed")} indeterminate />
            <Checkbox label={t("ds.c.disabled")} disabled />
            <Switch label={on ? t("ui.on") : t("ui.off")} checked={on} onCheckedChange={setOn} />
            <Switch label={t("ds.c.locked")} checked={false} disabled onCheckedChange={() => {}} />
          </div>
        </Panel>

        <Panel title={t("ds.c.comboboxMenuTooltipAndPopover")} titleId="ds-pop" bodyClassName="flex flex-wrap items-start gap-(--gap-3) p-(--pad-3)">
          <Combobox
            label={t("ds.c.letter")}
            triggerLabel={t("ds.c.letterOf", { value: combo ?? t("ds.c.none") })}
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
            label={t("ds.c.actions")}
            items={[
              { id: "rename", label: t("ds.c.rename"), shortcut: "F2", onSelect: () => {} },
              { id: "disabled", label: t("ds.c.archive"), disabled: true },
              {
                id: "move",
                label: t("ds.c.move"),
                items: [
                  { id: "inbox", label: t("ds.c.inbox"), onSelect: () => {} },
                  { id: "later", label: t("ds.c.later"), onSelect: () => {} },
                ],
              },
            ]}
          />
          <Popover label={t("ds.c.aboutThisRow")} trigger={<span className="t-ui">{t("ds.c.details")}</span>}>
            <p className="t-body text-fg-2">{t("ds.c.theRowKeepsItsPlaceThis")}</p>
          </Popover>
        </Panel>

        <Panel title={t("ds.c.tabsSegmentedAndKeys")} titleId="ds-tabs" bodyClassName="grid gap-(--gap-3) p-(--pad-3)">
          <Tabs
            label={t("ds.c.sections")}
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "one", label: t("ds.c.overview"), content: t("ds.c.theOverviewIsTheFirstPanel") },
              { value: "two", label: t("ds.c.activity"), content: t("ds.c.activityListsTheRuns") },
              { value: "three", label: t("ds.c.locked"), content: t("ds.c.hidden"), disabled: true },
            ]}
          />
          <div className="flex flex-wrap items-center gap-(--gap-4)">
            <Segmented
              label={t("ds.c.permissionMode")}
              value={mode}
              onChange={setMode}
              options={[
                { value: "ask", label: t("ds.c.ask"), hint: t("ds.c.askBeforeEveryCommand") },
                { value: "auto", label: t("ds.c.auto") },
                { value: "plan", label: t("ds.c.plan"), disabled: true },
              ]}
            />
            <KbdChord caps={["Ctrl", "K"]} />
            <Kbd>?</Kbd>
          </div>
        </Panel>

        <Panel title={t("ds.c.dialogAndSheet")} titleId="ds-dialog" bodyClassName="flex flex-wrap gap-(--gap-2) p-(--pad-3)">
          <Button onClick={() => setDialog(true)}>{t("ds.c.openDialog")}</Button>
          <Button onClick={() => setSheet(true)}>{t("ds.c.openSheet")}</Button>
          <Dialog title={t("ds.c.renameHarness")} description={t("ds.c.theNameIsWhatTheList")} open={dialog} onOpenChange={setDialog}>
            <Input label={t("ds.c.name")} defaultValue={t("ds.c.agileHarness")} />
          </Dialog>
          <Sheet title={t("ds.c.keyboardMap")} open={sheet} onOpenChange={setSheet} showClose>
            <p className="t-body p-(--pad-3) text-fg-2">{t("ds.c.theSheetTrapsFocusAndReturns")}</p>
          </Sheet>
        </Panel>

        <Panel title={t("ds.c.noticeToastEmptyAndError")} titleId="ds-state" bodyClassName="grid gap-(--gap-3) p-(--pad-3)">
          <Notice tone="info" title={t("ds.c.savedOnThisDevice")}>{t("ds.c.exportAnOhmFileToShare")}</Notice>
          <Notice tone="warn" title={t("ds.c.noModelChosen")}>{t("ds.c.thisConnectionRefusesARunWithout")}</Notice>
          <Notice tone="fault" title={t("ds.c.couldntReachTheLocalEngine")} action={<Button size="sm">{t("ui.retry")}</Button>}>
            {t("ds.c.savedHarnessesCantBeListedRight")}
          </Notice>
          <div className="flex flex-wrap gap-(--gap-2)">
            <Button size="sm" onClick={() => push({ title: t("ds.c.saved"), body: t("ds.c.theHarnessIsOnThisDevice"), tone: "info" })}>{t("ds.c.infoToast")}</Button>
            <Button size="sm" onClick={() => push({ title: t("ds.c.noModel"), body: t("ds.c.pickOneBeforeTheRun"), tone: "warn" })}>{t("ds.c.warnToast")}</Button>
            <Button size="sm" variant="danger" onClick={() => push({ title: t("ds.c.theSidecarDidNotAnswer"), body: t("ds.c.theListStaysAsItWas"), tone: "fault" })}>{t("ds.c.faultToast")}</Button>
          </div>
          <EmptyState title={t("ds.c.noChatsYet")} icon={<Plus className="size-(--icon)" aria-hidden />} action={<Button icon={<Plus className="size-(--icon)" aria-hidden />}>{t("ds.c.newChat")}</Button>}>
            {t("ds.c.startOneAndItShowsUp")}
          </EmptyState>
          <ErrorState
            title={t("ds.c.couldntLoadChats")}
            reason={t("ds.c.theSidecarDidNotAnswerX")}
            diagnostic="timeout after 5s · sidecar"
            onRetry={() => {}}
          />
        </Panel>

        <Panel title={t("ds.c.skeletonBadgeAndStatus")} titleId="ds-skel" bodyClassName="grid gap-(--gap-3) p-(--pad-3)">
          <SkeletonText lines={2} />
          <Skeleton className="h-control-md w-40" />
          <SkeletonRows rows={2} label={t("ds.c.loadingChats")} />
          <div className="flex flex-wrap items-center gap-(--gap-2)">
            <Badge>{t("ds.c.notConnected")}</Badge>
            <Badge tone="signal">{t("ds.c.connected")}</Badge>
            <Badge tone="warn">{t("ds.c.noModelChosen")}</Badge>
            <Badge tone="fault">{t("ds.c.keyRejected")}</Badge>
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

        <Panel title={t("ds.c.listRow")} titleId="ds-row" bodyClassName="grid gap-(--gap-1) p-(--pad-2)">
          <ListRow title="Anthropic" meta="claude-sonnet-5-5" selected trailing={<Badge tone="signal">{t("ds.c.connected")}</Badge>} />
          <ListRow title="OpenAI" description={t("ds.c.notConnectedAddAKeyTo")} />
          <ListRow title="Ollama local" meta="http://127.0.0.1:11434" disabled />
        </Panel>

        <Panel title={t("ds.c.transcriptSize")} titleId="ds-type" bodyClassName="grid gap-(--gap-2) p-(--pad-3)">
          <div className="flex items-center gap-(--gap-2)">
            <Button size="sm" onClick={() => setTranscript((size) => Math.max(12, size - 1))}>{t("ds.c.smaller")}</Button>
            <span className="t-ui text-fg-2">{t("ds.c.transcriptPx", { n: transcript })}</span>
            <Button size="sm" onClick={() => setTranscript((size) => Math.min(20, size + 1))}>{t("ds.c.larger")}</Button>
          </div>
          <p className="t-transcript max-w-[68ch] text-fg-1">{t("ds.c.theConversationUsesThisSizeIt")}</p>
          <p className="t-display">{t("ds.c.display")}</p>
          <p className="t-title">{t("ds.c.title")}</p>
          <p className="t-heading">{t("ds.c.heading")}</p>
          <p className="t-body">{t("ds.c.body")}</p>
          <p className="t-ui">{t("ds.c.interface")}</p>
          <p className="t-meta">{t("ds.c.meta")}</p>
          <p className="t-caption">{t("ds.c.caption")}</p>
          <p className="t-code">code</p>
        </Panel>

        <Panel variant="float" title={t("ds.c.float")} titleId="ds-float" bodyClassName="p-(--pad-3)">
          {t("ds.c.sheetsMenusAndTheCommandPalette")}
        </Panel>
        <Panel variant="inset" title={t("ds.c.inset")} titleId="ds-inset" bodyClassName="p-(--pad-3)">
          {t("ds.c.anInsetIsAContainedSurface")}
        </Panel>
        <Panel variant="dock" title={t("ds.c.dock")} titleId="ds-dock" bodyClassName="p-(--pad-3)">
          {t("ds.c.aDockedColumnHasTheHeader")}
        </Panel>
      </div>
    </main>
  );
}
