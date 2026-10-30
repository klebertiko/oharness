"use client";
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { PERMISSION_MODES, nextPermissionMode, type PermissionMode } from "@/lib/permissionMode";
import { Button, Notice, Segmented } from "@/components/ui";
import { tr, useI18n } from "@/i18n/store";
import { chatCommands, splitArgv, type ChatCommand, type ChatToolsInput, type ToolPreset } from "./chatCommands";
interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  skills?: unknown;
  live: boolean;
  /** Workspace tools (contract v1.1). Absent → menu is Commands & bundled Skills only. */
  tools?: ChatToolsInput;
  /** A Tool was chosen: the parent starts a `/execute/direct` run with this preset. */
  onPreset?: (preset: ToolPreset) => void;
  /** Permission mode of this conversation (enforced by the sidecar). Absent → no selector. */
  permissionMode?: PermissionMode;
  onPermissionModeChange?: (mode: PermissionMode) => void;
  /** Set when the sidecar refused to store a mode change. */
  permissionNotice?: string | null;
  /** The selected workspace's trust. Only shown under Auto: it decides whether the project's own scripts run unasked. */
  workspaceTrust?: { workspaceName: string; trusted: boolean; onChange: (trusted: boolean) => void; error?: string | null };
}
/** `/exec npm test` → preset, or a warning when the text contains shell syntax. */
export function presetFromSlashText(value: string): { preset: ToolPreset } | { warning: string } | null {
  const m = /^\/(exec|read)\s+([\s\S]+)$/.exec(value.trim());
  if (!m) return null;
  if (m[1] === "read") return { preset: { name: "read", path: m[2].trim() } };
  const { argv, shellSyntax } = splitArgv(m[2]);
  if (!argv.length) return null;
  if (shellSyntax.length) return { warning: tr("chat.composer.shellWarning", { ops: shellSyntax.join(" ") }) };
  return { preset: { name: "exec", argv } };
}
export function ChatComposer({ value, onChange, onSend, inputRef, skills, live, tools, onPreset, permissionMode, onPermissionModeChange, permissionNotice, workspaceTrust }: Props) {
  const { t, locale } = useI18n();
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  useEffect(() => () => { loadGeneration.current++; }, []);
  const [confirmingTrust, setConfirmingTrust] = useState(false);
  const [confirmingFull, setConfirmingFull] = useState(false);
  // Full runs commands unasked: it is chosen on purpose (a confirmation), never by cycling or by accident.
  useEffect(() => { setConfirmingFull(false); }, [permissionMode, live]);
  const choosePermission = (next: PermissionMode) => {
    if (next === "full" && permissionMode !== "full") { setConfirmingFull(true); return; }
    setConfirmingFull(false);
    onPermissionModeChange?.(next);
  };
  const query = /^\/([^\s/]*)$/.exec(value)?.[1] ?? null;
  const commands = useMemo(() => chatCommands(skills, tools), [skills, tools, locale]);
  const options = useMemo(() => commands.filter(command =>
    (command.name + " " + command.description).toLowerCase().includes((query ?? "").toLowerCase())
  ), [commands, query]);
  const open = query !== null && dismissed !== value;
  const selected = Math.min(cursor, Math.max(0, options.length - 1));
  const optionId = (index: number) => id + "-command-" + index;
  const noWorkspace = tools !== undefined && !tools.workspace;
  const slashPreset = useMemo(() => presetFromSlashText(value), [value, locale]);
  useEffect(() => {
    if (open) listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, selected, query]);
  const choose = (command: ChatCommand) => {
    if (live) return;
    loadGeneration.current++;
    setLoading(null);
    setLoadError(null);
    setDismissed(null);
    setCursor(0);
    if (command.kind === "Tool") {
      if (command.takesArgs) { onChange("/" + command.name + " "); inputRef.current?.focus(); return; }
      onChange("");
      if (command.preset) onPreset?.(command.preset);
      inputRef.current?.focus();
      return;
    }
    if (command.loadDraft) {
      const generation = ++loadGeneration.current;
      setLoadError(null);
      setLoading(command.id);
      void command.loadDraft().then(text => {
        if (generation === loadGeneration.current) onChange(text);
      }).catch(() => {
        if (generation === loadGeneration.current) setLoadError(t("chat.composer.skillError"));
      }).finally(() => {
        if (generation === loadGeneration.current) setLoading(null);
      });
      inputRef.current?.focus();
      return;
    }
    onChange(command.draft ?? "");
    command.run?.();
    inputRef.current?.focus();
  };
  const submit = () => {
    // While a run is live a plain message goes to the stage, which queues it; commands wait for the run to finish.
    if (live && slashPreset) return;
    if (slashPreset && "preset" in slashPreset) { onPreset?.(slashPreset.preset); onChange(""); return; }
    if (slashPreset && "warning" in slashPreset) return;
    onSend();
  };
  return <div className="relative min-w-0">
    {open && <div className="oh-float absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-40 overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line-soft px-3 py-2 text-meta text-ink-mute">
        <span>{tools?.workspace ? t("chat.composer.menuTitleWorkspace", { name: tools.workspace.name }) : t("chat.composer.menuTitle")}</span><span className="max-sm:hidden">{t("chat.composer.menuKeys")}</span>
      </div>
      {live && <p role="status" className="px-3 py-2 text-body text-warn-text">{t("chat.composer.liveBlock")}</p>}
      {noWorkspace && !live && <p role="note" className="px-3 py-2 text-body text-ink-mute">{t("chat.composer.needFolder")}</p>}
      <div ref={listRef} id={id + "-commands"} role="listbox" aria-label={t("chat.composer.listAria")} className="max-h-[min(320px,45vh)] overflow-y-auto p-1">
        {options.map((command, index) => <button key={command.id} id={optionId(index)} type="button" role="option" tabIndex={-1}
          aria-selected={index === selected} aria-disabled={live}
          onMouseDown={event => event.preventDefault()} onMouseMove={() => setCursor(index)} onClick={() => choose(command)}
          className={"flex min-h-control-lg w-full items-center gap-3 rounded-control px-3 py-1.5 text-left " + (index === selected ? "bg-sub-300" : "hover:bg-sub-200") + (live ? " opacity-50" : "")}>
          <span className="min-w-0 flex-1"><span className="t-meta block truncate text-ink">/{command.name}</span>
            <span className="block text-body text-ink-mute">{command.description}</span></span>
          {command.hint && <span className={"t-meta flex-none rounded-control px-1.5 py-0.5 " + (command.kind === "Tool" ? "bg-signal/15 text-signal-text" : "bg-sub-300 text-ink-mute")}>{t(`chat.hint.${command.hint}`)}</span>}
          <span className="t-meta flex-none text-ink-mute">{t(`chat.kind.${command.kind}`)}</span>
        </button>)}
      </div>
      {options.length === 0 && <p role="status" className="px-4 py-3 text-body text-ink-mute">{t("chat.composer.noMatch")}</p>}
    </div>}
    {slashPreset && "warning" in slashPreset && <Notice tone="warn" className="mx-3 mt-3">{slashPreset.warning}</Notice>}
    {loading && <p role="status" className="px-4 pt-2 text-body text-ink-mute">{t("chat.composer.loadingSkill")}</p>}
    {loadError && <Notice tone="fault" className="mx-3 mt-3">{loadError}</Notice>}
    <textarea ref={inputRef} value={value} rows={2} aria-label={t("chat.composer.inputAria")}
      aria-autocomplete="list" aria-haspopup="listbox" aria-controls={open ? id + "-commands" : undefined}
      aria-activedescendant={open && options.length ? optionId(selected) : undefined}
      onChange={event => { loadGeneration.current++; setLoading(null); setLoadError(null); onChange(event.target.value); setCursor(0); setDismissed(null); }}
      onBlur={() => setDismissed(value)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        // Shift+Tab cycles the permission mode (like Claude Code). Only the bare chord:
        // Ctrl/Alt/Meta+Shift+Tab stay with the browser and the OS.
        if (permissionMode && onPermissionModeChange && event.key === "Tab" && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
          event.preventDefault(); onPermissionModeChange(nextPermissionMode(permissionMode)); return;
        }
        if (open) {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDismissed(value); return; }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setCursor(options.length ? (selected + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length : 0);
            return;
          }
          if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
            event.preventDefault(); if (options[selected]) choose(options[selected]); return;
          }
        } else if (query !== null && event.key === "ArrowDown") {
          event.preventDefault(); setDismissed(null); return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); submit(); }
      }}
      placeholder={live ? t("chat.composer.placeholderLive") : tools?.workspace ? t("chat.composer.placeholderWorkspace", { name: tools.workspace.name }) : t("chat.composer.placeholder")}
      className="block min-h-16 w-full resize-none bg-transparent px-4 pt-3.5 text-reading text-ink outline-hidden placeholder:text-ink-mute" />
    {permissionMode && onPermissionModeChange && <div className="flex flex-wrap items-center gap-2 px-4 pb-1 pt-1">
      <Segmented label={t("chat.composer.permissionMode")} value={permissionMode} onChange={choosePermission}
        options={PERMISSION_MODES.map(mode => ({ value: mode, label: t(`chat.perm.${mode}.label`), hint: t(`chat.perm.${mode}.hint`), disabled: live }))} />
      <span className="text-meta text-ink-mute">{t("chat.composer.cycleHint", { summary: t(`chat.perm.${permissionMode}.summary`) })}</span>
      {permissionNotice && <Notice tone="fault" className="w-full">{permissionNotice}</Notice>}
      {confirmingFull && <div role="alertdialog" aria-label={t("chat.composer.switchFullAria")} className="w-full rounded-control border border-warn p-3 text-body text-ink">
        <p>{t("chat.composer.fullWarning")}</p>
        <div className="mt-2 flex gap-2">
          <Button variant="primary" onClick={() => { setConfirmingFull(false); onPermissionModeChange?.("full"); }}>{t("chat.composer.useFull")}</Button>
          <Button autoFocus onClick={() => setConfirmingFull(false)}>{t("common.cancel")}</Button>
        </div>
      </div>}
      {(permissionMode === "auto_workspace" || permissionMode === "workspace_write") && workspaceTrust && <div className="w-full text-body text-ink-mute">
        {workspaceTrust.trusted
          ? <p className="flex flex-wrap items-center gap-2"><span>{t("chat.composer.trustedBody", { mode: t(`chat.perm.${permissionMode}.label`) })}</span>
              <Button size="sm" disabled={live} onClick={() => workspaceTrust.onChange(false)}>{t("chat.composer.revokeTrust")}</Button></p>
          : <p className="flex flex-wrap items-center gap-2"><span>{t(permissionMode === "workspace_write" ? "chat.composer.untrustedWrite" : "chat.composer.untrustedAuto", { mode: t(`chat.perm.${permissionMode}.label`) })}</span>
              <Button size="sm" disabled={live} onClick={() => setConfirmingTrust(true)}>{t("chat.composer.trustThis")}</Button></p>}
        {confirmingTrust && !workspaceTrust.trusted && <div role="alertdialog" aria-label={t("chat.composer.trustAria")} className="mt-2 rounded-control border border-warn p-3 text-ink">
          <p>{t("chat.composer.trustBody", { name: workspaceTrust.workspaceName })}</p>
          <div className="mt-2 flex gap-2">
            <Button variant="primary" onClick={() => { setConfirmingTrust(false); workspaceTrust.onChange(true); }}>{t("chat.composer.trust")}</Button>
            <Button autoFocus onClick={() => setConfirmingTrust(false)}>{t("common.cancel")}</Button>
          </div>
        </div>}
        {workspaceTrust.error && <Notice tone="fault" className="mt-1">{workspaceTrust.error}</Notice>}
      </div>}
    </div>}
  </div>;
}
