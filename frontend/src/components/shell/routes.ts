"use client";

export type Destination = "chats" | "forja" | "studio" | "plugins" | "providers" | "settings";

export interface AppLocation {
  dest: Destination;
  sessionId?: string;
  itemId?: string;
  harness?: string;
  section?: string;
}

const SETTINGS_SECTIONS = ["general", "permissions", "shortcuts", "providers", "plugins", "data", "advanced"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export const SETTINGS_SECTION_LIST: readonly SettingsSection[] = SETTINGS_SECTIONS;

function clean(pathname: string): string {
  const path = pathname.split("?")[0].split("#")[0].replace(/\/index\.html$/, "").replace(/\/$/, "");
  return path || "/";
}

function seg(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parsePath(pathname: string): AppLocation {
  const path = clean(pathname);
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return { dest: "chats" };
  if (parts[0] === "s") return { dest: "chats", sessionId: seg(parts[1]) };
  if (parts[0] === "forja") {
    if (parts[1] === "item" && parts[2]) return { dest: "forja", itemId: seg(parts[2]) };
    return { dest: "forja" };
  }
  if (parts[0] === "studio") return { dest: "studio", harness: seg(parts[1]) };
  if (parts[0] === "plugins") return { dest: "plugins" };
  if (parts[0] === "providers") return { dest: "providers" };
  if (parts[0] === "settings") {
    const section = seg(parts[1]);
    return { dest: "settings", section: section && (SETTINGS_SECTIONS as readonly string[]).includes(section) ? section : "general" };
  }
  return { dest: "chats" };
}

export function hrefFor(loc: AppLocation): string {
  switch (loc.dest) {
    case "chats":
      return loc.sessionId ? `/s/${encodeURIComponent(loc.sessionId)}` : "/";
    case "forja":
      return loc.itemId ? `/forja/item/${encodeURIComponent(loc.itemId)}` : "/forja";
    case "studio":
      return loc.harness ? `/studio/${encodeURIComponent(loc.harness)}` : "/studio";
    case "plugins":
      return "/plugins";
    case "providers":
      return "/providers";
    case "settings":
      return `/settings/${encodeURIComponent(loc.section || "general")}`;
    default:
      return "/";
  }
}

export function hrefForDestination(dest: Destination, activeSessionId?: string | null): string {
  if (dest === "chats" && activeSessionId) return hrefFor({ dest: "chats", sessionId: activeSessionId });
  if (dest === "settings") return hrefFor({ dest: "settings", section: "general" });
  return hrefFor({ dest });
}

/** Paths the static host should answer with the app document. */
export function isAppPath(pathname: string): boolean {
  const path = clean(pathname);
  if (path === "/") return true;
  return /^\/(?:s(?:\/[^/]+)?|forja(?:\/item\/[^/]+)?|studio(?:\/[^/]+)?|plugins|providers|settings(?:\/[^/]+)?)\/?$/.test(path);
}

declare global {
  interface Window {
    __OH_PATH__?: string;
  }
}

export function currentPath(): string {
  if (typeof window === "undefined") return "/";
  const state = window.history.state as { oh?: number; path?: string } | null;
  if (state?.oh && typeof state.path === "string") return state.path;
  if (typeof window.__OH_PATH__ === "string" && window.__OH_PATH__) return window.__OH_PATH__;
  return window.location.pathname || "/";
}

export function navigate(path: string): void {
  if (typeof window === "undefined") return;
  const next = clean(path) === "/" ? "/" : clean(path);
  window.__OH_PATH__ = next;
  if (currentPath() === next && window.location.pathname === (next === "/" ? "/" : next)) {
    window.dispatchEvent(new Event("oh-nav"));
    return;
  }
  window.history.pushState({ oh: 1, path: next }, "", next);
  window.dispatchEvent(new Event("oh-nav"));
}
