"use client";

import { useThreadStore, type Thread } from "@/store/threadStore";
import { useWorkspaceStore } from "@/store/workspaceStore";

/**
 * The session list P4 will own. Until that API lands, this reads the threads
 * already on the device and groups them under the chosen project.
 */
export interface SessionSummary {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  updatedAt: number;
  pinned: boolean;
  unread: boolean;
  pending: boolean;
  archived: boolean;
}

export interface SessionGroup {
  id: string;
  name: string;
  sessions: SessionSummary[];
}

const DEVICE = "device";

type Extra = { pinned?: boolean; unread?: boolean; pending?: boolean };

function flag(thread: Thread, key: keyof Extra): boolean {
  return Boolean((thread as Thread & Extra)[key]);
}

export function listSessions(): SessionSummary[] {
  const threads = useThreadStore.getState().threads;
  let projectId = DEVICE;
  let projectName = "";
  try {
    const workspace = useWorkspaceStore.getState();
    const chosen = workspace.projects.find((p) => p.id === workspace.chosenProjectId);
    if (chosen) {
      projectId = chosen.id;
      projectName = chosen.name;
    }
  } catch {
    /* the project list is optional; sessions still group under this device */
  }
  return threads.map((thread) => ({
    id: thread.id,
    title: thread.title,
    projectId,
    projectName,
    updatedAt: thread.updatedAt,
    pinned: flag(thread, "pinned"),
    unread: flag(thread, "unread"),
    pending: flag(thread, "pending"),
    archived: Boolean(thread.archived),
  }));
}

export function groupSessions(items: SessionSummary[]): SessionGroup[] {
  const open = items.filter((item) => !item.archived);
  const byId = new Map<string, SessionGroup>();
  for (const item of open) {
    const group = byId.get(item.projectId) ?? { id: item.projectId, name: item.projectName, sessions: [] };
    group.sessions.push(item);
    byId.set(item.projectId, group);
  }
  for (const group of byId.values()) {
    group.sessions.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }
  return [...byId.values()];
}
