"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Hammer,
  Inbox,
  ListTree,
  MessagesSquare,
  Plug,
  Plus,
  Puzzle,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button, ListRow } from "@/components/ui";
import { useT } from "@/i18n/store";
import type { MessageKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { useThreadStore } from "@/store/threadStore";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { chordCaps, useIsMac } from "./keys";
import { navigate } from "./routes";
import { groupSessions, listSessions } from "./sessions";
import { startSession } from "./commands";
import { useShellStore, type RailSection } from "./shellStore";

type Variant = "open" | "rail" | "drawer";

const DESTINATIONS: { id: RailSection; label: MessageKey; icon: LucideIcon; chord?: string }[] = [
  { id: "chats", label: "shell.rail.chats", icon: MessagesSquare, chord: "Alt+1" },
  { id: "forja", label: "shell.rail.forja", icon: Hammer, chord: "Alt+2" },
  { id: "studio", label: "shell.rail.studio", icon: Boxes, chord: "Alt+3" },
  { id: "plugins", label: "shell.nav.plugins", icon: Puzzle, chord: "Alt+4" },
];

const FOOTER: { id: RailSection; label: MessageKey; icon: LucideIcon; chord?: string }[] = [
  { id: "providers", label: "shell.rail.providers", icon: Plug },
  { id: "settings", label: "shell.nav.settings", icon: Settings, chord: "Alt+5" },
];

function go(section: RailSection) {
  useShellStore.getState().setSection(section);
  useShellStore.getState().setDrawerOpen(false);
}

export function Sidebar({ variant }: { variant: Variant }) {
  const t = useT();
  const mac = useIsMac();
  const section = useShellStore((s) => s.section);
  const rail = variant === "rail";
  const threads = useThreadStore((s) => s.threads);
  const activeId = useThreadStore((s) => s.activeThreadId);
  const projects = useWorkspaceStore((s) => s.projects);
  const chosen = useWorkspaceStore((s) => s.chosenProjectId);
  // Persisted sessions must not paint on the first client render: the server has none.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const groups = useMemo(() => (mounted ? groupSessions(listSessions()) : []), [threads, projects, chosen, mounted]);

  const openSession = (id: string) => {
    useThreadStore.getState().selectThread(id);
    useShellStore.getState().applySection("chats");
    navigate(`/s/${id}`);
    useShellStore.getState().setDrawerOpen(false);
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", rail ? "items-center px-1" : "px-2")}>
      <div className={cn("flex-none pt-2", rail ? "w-full" : "pb-1")}>
        <Button
          variant={rail ? "ghost" : "secondary"}
          size={rail ? "md" : "md"}
          iconOnly={rail}
          icon={<Plus size={16} aria-hidden />}
          aria-label={t("shell.sessions.new")}
          title={t("shell.sidebar.tooltip", { action: t("shell.sessions.new"), keys: chordCaps("Mod+N", mac).join("+") })}
          className={rail ? undefined : "w-full justify-start"}
          onClick={() => startSession()}
        >
          {rail ? null : t("shell.sessions.new")}
        </Button>
      </div>

      {!rail && (
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {groups.length === 0 ? (
            <p className="px-2 py-3 text-body text-ink-mute">{t("shell.sessions.hint")}</p>
          ) : (
            groups.map((group) => (
              <section key={group.id} aria-label={group.name || t("shell.sessions.device")} className="pt-3">
                <h2 className="px-2 pb-1 text-meta font-medium text-ink-mute">{group.name || t("shell.sessions.device")}</h2>
                <ul className="flex flex-col gap-px">
                  {group.sessions.map((session) => (
                    <li key={session.id}>
                      <ListRow
                        title={session.title}
                        selected={session.id === activeId && section === "chats"}
                        aria-current={session.id === activeId && section === "chats" ? "page" : undefined}
                        onClick={() => openSession(session.id)}
                        trailing={
                          <span className="inline-flex items-center gap-1 text-meta">
                            {session.unread && (
                              <span className="text-signal-text">
                                •<span className="sr-only"> {t("shell.sessions.unread")}</span>
                              </span>
                            )}
                            {session.pending && (
                              <span className="text-warn-text">
                                ●<span className="sr-only"> {t("shell.sessions.pending")}</span>
                              </span>
                            )}
                          </span>
                        }
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}

      {rail && <div className="min-h-0 flex-1" />}

      <nav aria-label={t("shell.rail.destinations")} className={cn("flex flex-none flex-col gap-px", rail ? "w-full items-center pb-1" : "border-t border-line-soft py-2")}>
        {DESTINATIONS.map((item) => (
          <DestButton key={item.id} {...item} active={section === item.id} rail={rail} mac={mac} onClick={() => go(item.id)} />
        ))}
        {!rail && section === "forja" && (
          <div className="mt-1 flex flex-col gap-px pl-3">
            <DestButton key="inbox" id="forja" label="shell.forja.inbox" icon={Inbox} active={false} rail={false} mac={mac} onClick={() => go("forja")} />
            <DestButton key="items" id="forja" label="shell.forja.items" icon={ListTree} active={false} rail={false} mac={mac} onClick={() => go("forja")} />
          </div>
        )}
        <div className={cn("mt-1 flex flex-col gap-px border-t border-line-soft pt-2", rail ? "w-full items-center" : "")}>
          {FOOTER.map((item) => (
            <DestButton key={item.id} {...item} active={section === item.id} rail={rail} mac={mac} onClick={() => go(item.id)} />
          ))}
        </div>
      </nav>
    </div>
  );
}

function DestButton({
  label,
  icon: Icon,
  chord,
  active,
  rail,
  mac,
  onClick,
}: {
  id: RailSection;
  label: MessageKey;
  icon: LucideIcon;
  chord?: string;
  active: boolean;
  rail: boolean;
  mac: boolean;
  onClick: () => void;
}) {
  const t = useT();
  const name = t(label);
  const hint = chord ? chordCaps(chord, mac).join("+") : undefined;
  return (
    <Button
      variant="ghost"
      size="md"
      iconOnly={rail}
      icon={<Icon size={16} aria-hidden />}
      aria-label={name}
      aria-current={active ? "page" : undefined}
      title={hint ? `${name} · ${hint}` : name}
      onClick={onClick}
      className={cn(rail ? undefined : "w-full justify-start", active && "bg-sub-200 text-ink")}
    >
      {rail ? null : <span className="truncate">{name}</span>}
    </Button>
  );
}
