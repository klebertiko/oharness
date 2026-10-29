"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";

import { Panel } from "@/components/shell/Panel";
import { Button, EmptyState, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useThreadStore, type Thread } from "@/store/threadStore";

/**
 * The chat list beside the conversation. New chat on top, chats grouped by
 * recency, and a per-row menu for rename / archive / delete. Archived chats
 * live in a collapsed section at the bottom until restored or removed.
 *
 * It is a navigation list, not a listbox: each row is a button, the open chat
 * carries `aria-current`, and the arrow keys move between rows (and open the
 * chat they land on).
 */
export function ThreadsSidebar() {
  const threads = useThreadStore((s) => s.threads);
  const activeThreadId = useThreadStore((s) => s.activeThreadId);
  const startNewChat = useThreadStore((s) => s.startNewChat);
  const selectThread = useThreadStore((s) => s.selectThread);

  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const matches = useCallback((thread: Thread) => thread.title.toLocaleLowerCase().includes(needle), [needle]);
  const open = useMemo(() => threads.filter((t) => !t.archived && matches(t)), [threads, matches]);
  const archived = useMemo(() => threads.filter((t) => t.archived && matches(t)), [threads, matches]);
  const groups = useMemo(() => groupByRecency(open), [open]);
  const listRef = useRef<HTMLElement>(null);

  const onNew = useCallback(() => startNewChat(), [startNewChat]);

  /* Arrow keys on a row open and focus the neighbouring chat. Rows are found in
     the DOM so grouping and the archived section need no index bookkeeping. */
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const target = e.target as HTMLElement;
      if (!target.matches("[data-thread-row]")) return;
      const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-thread-row]") ?? [])];
      const next = rows[rows.indexOf(target) + (e.key === "ArrowDown" ? 1 : -1)];
      if (!next) return;
      e.preventDefault();
      next.focus();
      selectThread(next.dataset.threadRow!);
    },
    [selectThread],
  );

  return (
    <Panel title="Chats" className="h-full">
      <div className="px-2 pb-1 pt-2">
        <Button
          icon={<Plus size={14} strokeWidth={2} aria-hidden />}
          onClick={onNew}
          aria-current={activeThreadId === null ? "true" : undefined}
          className={cn("w-full justify-start", activeThreadId === null && "bg-sub-300")}
        >
          New chat
        </Button>
      </div>

      <div className="px-2 py-1">
        <Input
          type="search"
          aria-label="Search chats"
          placeholder="Search chats"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          compact
        />
      </div>

      {open.length === 0 && archived.length === 0 ? (
        <div className="px-2 py-2">
          {needle ? (
            <p role="status" className="text-body text-ink-mute">No matching chats.</p>
          ) : (
            <EmptyState title="No chats yet">Start one and it shows up here.</EmptyState>
          )}
        </div>
      ) : (
        <nav ref={listRef} aria-label="Chats" onKeyDown={onKeyDown} className="flex flex-col pb-2">
          {groups.map(({ label, items }) => (
            <section key={label} aria-label={label} className="px-1.5 pt-2">
              <h3 className="px-2 pb-1 text-meta font-medium text-ink-mute">{label}</h3>
              <ul className="flex flex-col gap-px">
                {items.map((thread) => (
                  <ThreadRow key={thread.id} thread={thread} active={thread.id === activeThreadId} onSelect={() => selectThread(thread.id)} />
                ))}
              </ul>
            </section>
          ))}

          {archived.length > 0 && (
            <details key={needle ? "search" : "all"} open={needle ? true : undefined} className="mt-2 px-1.5">
              <summary className="oh-focus-inner min-h-control-md cursor-pointer list-none rounded-control px-2 py-1.5 text-meta font-medium text-ink-mute marker:content-none hover:text-ink">
                Archived · {archived.length}
              </summary>
              <ul className="flex flex-col gap-px pt-1">
                {archived.map((thread) => (
                  <ThreadRow key={thread.id} thread={thread} active={thread.id === activeThreadId} onSelect={() => selectThread(thread.id)} />
                ))}
              </ul>
            </details>
          )}
        </nav>
      )}
    </Panel>
  );
}

function ThreadRow({ thread, active, onSelect }: { thread: Thread; active: boolean; onSelect: () => void }) {
  const renameThread = useThreadStore((s) => s.renameThread);
  const archiveThread = useThreadStore((s) => s.archiveThread);
  const restoreThread = useThreadStore((s) => s.restoreThread);
  const deleteThread = useThreadStore((s) => s.deleteThread);

  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState(thread.title);
  const titleId = useId();
  const rowRef = useRef<HTMLLIElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const closeMenu = useCallback((refocus = true) => {
    setMenuOpen(false);
    setConfirmingDelete(false);
    if (refocus) moreRef.current?.focus();
  }, []);

  // Outside press and Escape close the menu; focus goes back to its button.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) closeMenu(false);
    };
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    // Defer binding so the click that opened the menu can't immediately close it.
    const id = window.setTimeout(() => {
      document.addEventListener("pointerdown", onDown);
      document.addEventListener("keydown", onEsc);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen, closeMenu]);

  // Opening the menu moves focus to its first item; the delete confirmation
  // focuses Cancel, the safe default.
  useEffect(() => {
    if (!menuOpen) return;
    const target = confirmingDelete ? menuRef.current?.querySelector<HTMLElement>("[data-cancel]") : menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    target?.focus();
  }, [menuOpen, confirmingDelete]);

  useEffect(() => {
    if (editing) {
      setDraft(thread.title);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, thread.title]);

  const commitRename = () => {
    const next = draft.trim();
    if (next && next !== thread.title) renameThread(thread.id, next);
    setEditing(false);
  };

  const onMenuKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[to].focus();
  };

  return (
    <li ref={rowRef} className="group/row relative">
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setEditing(false);
          }}
          aria-label="Chat name"
          className="h-control-lg w-full rounded-control border border-line-strong bg-sub-200 px-2.5 text-title text-ink focus-visible:border-signal"
        />
      ) : (
        <button
          type="button"
          data-thread-row={thread.id}
          onClick={onSelect}
          aria-current={active ? "true" : undefined}
          className={cn(
            "oh-focus-inner flex min-h-control-lg w-full items-center gap-2 rounded-control px-2.5 py-1.5 pr-9 text-left transition-colors",
            active ? "bg-sub-200 shadow-selected" : "hover:bg-sub-200",
          )}
        >
          <span id={titleId} className={cn("min-w-0 flex-1 truncate text-title", active ? "text-ink" : "text-ink-dim")}>{thread.title}</span>
          <span className="t-meta shrink-0 text-ink-mute group-focus-within/row:hidden group-hover/row:hidden">{relativeTime(thread.updatedAt)}</span>
        </button>
      )}

      {!editing && (
        <Button
          ref={moreRef}
          iconOnly
          size="sm"
          variant="ghost"
          aria-label="Chat actions"
          aria-describedby={titleId}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          icon={<MoreHorizontal size={15} strokeWidth={1.8} aria-hidden />}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100 aria-expanded:opacity-100 max-sm:opacity-100"
        />
      )}

      {menuOpen && (
        <div ref={menuRef} onKeyDown={onMenuKeyDown} className="oh-float absolute right-1.5 top-[calc(100%-2px)] z-40 w-46 p-1" role="menu" aria-label={`Actions for ${thread.title}`}>
          {confirmingDelete ? (
            <div className="px-2 py-1.5" role="group" aria-label="Confirm delete">
              <p className="pb-2 text-body text-ink-dim">Delete this chat and its messages?</p>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    deleteThread(thread.id);
                    closeMenu(false);
                  }}
                >
                  Delete chat
                </Button>
                <Button size="sm" data-cancel onClick={() => closeMenu()}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <MenuItem icon={Pencil} onClick={() => { setEditing(true); closeMenu(false); }}>
                Rename
              </MenuItem>
              {thread.archived ? (
                <MenuItem icon={ArchiveRestore} onClick={() => { restoreThread(thread.id); closeMenu(false); }}>
                  Restore
                </MenuItem>
              ) : (
                <MenuItem icon={Archive} onClick={() => { archiveThread(thread.id); closeMenu(false); }}>
                  Archive
                </MenuItem>
              )}
              <MenuItem icon={Trash2} danger onClick={() => setConfirmingDelete(true)}>
                Delete
              </MenuItem>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function MenuItem({ icon: Icon, children, onClick, danger = false }: { icon: typeof Pencil; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "oh-focus-inner flex min-h-control-md w-full items-center gap-2 rounded-control px-2 py-1 text-left text-body font-medium transition-colors max-sm:min-h-control-lg",
        danger ? "text-fault-text hover:bg-sub-200" : "text-ink-dim hover:bg-sub-200 hover:text-ink",
      )}
    >
      <Icon size={13} strokeWidth={1.8} aria-hidden />
      {children}
    </button>
  );
}

const DAY = 86_400_000;

function groupByRecency(threads: Thread[]): { label: string; items: Thread[] }[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const buckets: { label: string; items: Thread[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const t of threads) {
    if (t.updatedAt >= startOfToday) buckets[0].items.push(t);
    else if (t.updatedAt >= startOfToday - DAY) buckets[1].items.push(t);
    else if (t.updatedAt >= startOfToday - 7 * DAY) buckets[2].items.push(t);
    else buckets[3].items.push(t);
  }
  return buckets.filter((b) => b.items.length > 0);
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < DAY) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(ts);
  } catch {
    return "";
  }
}
