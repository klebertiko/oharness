"use client";
import { useEffect, useState } from "react";

/**
 * Keyboard conventions for OHarness.
 *
 * Rules, in the order they were applied:
 *  1. Never shadow a chord the host OS or browser owns (Ctrl+W, Ctrl+T, F5…).
 *  2. Mod = the platform's primary modifier. Alt is the *alternate* axis
 *     (panel geometry); Shift only ever extends or inverts an existing chord.
 *  3. Every chord in this table is reachable from the command palette, so no
 *     capability is keyboard-only knowledge.
 */

export type Chord = {
  /** Canonical spec: "Mod+K", "Mod+Shift+Z", "Alt+1", "?" */
  spec: string;
};

export interface KeySpec {
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  key: string;
}

export function parseChord(spec: string): KeySpec {
  const parts = spec.split("+");
  const key = parts[parts.length - 1];
  return {
    mod: parts.includes("Mod"),
    shift: parts.includes("Shift"),
    alt: parts.includes("Alt"),
    key,
  };
}

export function useIsMac(): boolean {
  const [mac, setMac] = useState(false);
  useEffect(() => {
    const p = `${navigator.platform} ${navigator.userAgent}`;
    setMac(/mac|iphone|ipad/i.test(p));
  }, []);
  return mac;
}

/** Render a chord as discrete caps: "Mod+Shift+Z" -> ["⌘","⇧","Z"] */
export function chordCaps(spec: string, mac: boolean): string[] {
  return spec.split("+").map((part) => {
    if (part === "Mod") return mac ? "⌘" : "Ctrl";
    if (part === "Shift") return mac ? "⇧" : "Shift";
    if (part === "Alt") return mac ? "⌥" : "Alt";
    if (part === "Enter") return "↵";
    if (part === "Escape") return "Esc";
    if (part === "ArrowUp") return "↑";
    if (part === "ArrowDown") return "↓";
    return part.length === 1 ? part.toUpperCase() : part;
  });
}

export function matchesChord(e: KeyboardEvent, spec: string, mac: boolean): boolean {
  const s = parseChord(spec);
  const modDown = mac ? e.metaKey : e.ctrlKey;
  const wrongMod = mac ? e.ctrlKey : e.metaKey;
  if (wrongMod) return false;
  if (!!s.mod !== modDown) return false;
  if (!!s.alt !== e.altKey) return false;
  // "?" is produced with Shift on most layouts, so it opts out of the check.
  if (s.key !== "?" && !!s.shift !== e.shiftKey) return false;
  return e.key.toLowerCase() === s.key.toLowerCase();
}

/** True while focus sits in something that legitimately eats plain keys. */
export function isEditingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

/**
 * True while focus sits inside a widget that owns plain letters for typeahead
 * (Radix Select/Menu, a listbox, a combobox). Bare chords must not fire there.
 */
export function isTypeaheadTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el?.closest?.('[role="listbox"],[role="menu"],[role="combobox"]');
}
