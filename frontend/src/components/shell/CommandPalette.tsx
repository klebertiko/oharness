"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CornerDownLeft } from "lucide-react";
import { matchCommands, type Command, type Match } from "./commands";
import { chordCaps, useIsMac } from "./keys";
import { Kbd, KbdChord, Sheet } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import { cn } from "@/lib/utils";

/**
 * The command palette: a sheet hung from the title bar, so it reads as the
 * search control expanding downward. It is a combobox (the query field) over a
 * listbox; the active option is announced through `aria-activedescendant`, the
 * result count through a polite status, and focus returns to the opener on
 * close (Sheet).
 */

function Highlight({ text, hits }: { text: string; hits: number[] }) {
  if (!hits.length) return <>{text}</>;
  const set = new Set(hits);
  return (
    <>
      {text.split("").map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="text-signal-text">
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  );
}

function Row({
  id,
  match,
  active,
  mac,
  onRun,
  onHover,
}: {
  id: string;
  match: Match;
  active: boolean;
  mac: boolean;
  onRun: () => void;
  onHover: () => void;
}) {
  const { command, hits } = match;
  const Icon = command.icon;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  return (
    // biome-ignore lint/a11y/useFocusableInteractive: options stay out of the tab order; focus remains on the combobox input and aria-activedescendant points at the active option
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled once on the combobox input (arrows and Enter), as in the ARIA combobox pattern
    <div
      ref={ref}
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={command.disabled || undefined}
      onMouseMove={onHover}
      onClick={onRun}
      className={cn(
        "flex h-control-md w-full cursor-pointer items-center gap-2.5 px-2.5 text-left max-sm:h-control-lg",
        command.disabled && "cursor-not-allowed opacity-45",
        active && "bg-sub-300",
      )}
    >
      <span className="h-3.5 w-0.5 flex-none rounded-none" style={{ background: command.role ?? (active ? "var(--signal)" : "transparent") }} aria-hidden />
      <Icon size={14} strokeWidth={1.6} absoluteStrokeWidth aria-hidden className={cn("flex-none", active ? "text-ink" : "text-ink-mute")} />
      <span className="t-title min-w-0 flex-1 truncate text-ink">
        <Highlight text={command.label} hits={hits} />
      </span>
      {command.meta && <span className="t-meta flex-none text-ink-mute">{command.meta}</span>}
      {command.chord && <KbdChord caps={chordCaps(command.chord, mac)} className="flex-none" />}
    </div>
  );
}

export function CommandPalette({ open, commands, onClose }: { open: boolean; commands: Command[]; onClose: () => void }) {
  const { t, plural } = useI18n();
  const mac = useIsMac();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const matches = useMemo(() => matchCommands(commands, query), [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }, [open]);
  useEffect(() => setCursor(0), [query]);

  const run = (i: number) => {
    const m = matches[i];
    if (!m || m.command.disabled) return;
    onClose();
    m.command.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault();
      setCursor((c) => Math.min(matches.length - 1, c + 1));
    } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(cursor);
    }
  };

  // Group headings are emitted inline so the list stays one flat, arrow-
  // navigable sequence: grouping is a label, not a nested structure.
  let lastGroup = "";
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const activeOption = matches.length ? optionId(Math.min(cursor, matches.length - 1)) : undefined;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()} title={t("shell.palette.title")} hideTitle placement="top" className="h-fit max-h-[min(64vh,520px)]">
      <div className="flex h-control-lg flex-none items-center gap-2.5 border-b border-line px-2.5">
        <span className="h-4 w-0.5 flex-none rounded-none bg-signal" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-label={t("shell.palette.searchAria")}
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={activeOption}
          aria-autocomplete="list"
          placeholder={t("shell.palette.placeholder")}
          /* The tick to the left marks focus inside this context; a ring around
             the only field in a modal would say what is already known. */
          className="t-title h-full min-w-0 flex-1 bg-transparent text-ink outline-hidden focus-visible:outline-hidden placeholder:text-ink-mute"
        />
      </div>

      <p role="status" className="sr-only">
        {matches.length === 0 ? t("shell.palette.noResults") : plural("shell.palette.results", matches.length)}
      </p>

      <div id={listId} role="listbox" aria-label={t("shell.palette.commands")} className="min-h-0 flex-1 overflow-y-auto py-1">
        {matches.length === 0 && (
          <p className="t-body px-3 py-6 text-center text-ink-mute">
            {t("shell.palette.nothing", { query })}
          </p>
        )}
        {matches.map((m, i) => {
          const showGroup = m.command.group !== lastGroup;
          lastGroup = m.command.group;
          return (
            <div key={m.command.id} role="presentation">
              {showGroup && (
                <div className="flex items-center gap-2 px-2.5 pb-1 pt-2.5" role="presentation">
                  <span className="t-label text-ink-mute">{m.command.group}</span>
                  <span className="h-px flex-1 bg-line-soft" aria-hidden />
                </div>
              )}
              <Row id={optionId(i)} match={m} active={i === cursor} mac={mac} onRun={() => run(i)} onHover={() => setCursor(i)} />
            </div>
          );
        })}
      </div>

      <div className="flex h-6 flex-none items-center gap-3 border-t border-line bg-sub-200 px-2.5 max-sm:hidden" aria-hidden>
        <span className="t-meta flex items-center gap-1 text-ink-mute">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          {t("shell.palette.move")}
        </span>
        <span className="t-meta flex items-center gap-1 text-ink-mute">
          <Kbd>
            <CornerDownLeft size={10} strokeWidth={2} aria-hidden />
          </Kbd>
          {t("shell.palette.run")}
        </span>
        <span className="t-meta flex items-center gap-1 text-ink-mute">
          <Kbd>Esc</Kbd>
          {t("shell.palette.close")}
        </span>
      </div>
    </Sheet>
  );
}
