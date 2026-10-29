"use client";
import { create } from "zustand";
import { detectLocale, isLocale, LOCALE_KEY, type Locale } from "./locale";
import { translate, type MessageKey, type Vars } from "./translate";

/** The interface language. It starts as English on the server and on the first client render, so the static HTML and the hydrated tree agree; `hydrate()` then reads the saved choice or the browser language. */
interface LocaleState {
  locale: Locale;
  hydrate: () => void;
  setLocale: (locale: Locale) => void;
}

const apply = (locale: Locale) => {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
};

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: "en",
  hydrate: () => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(LOCALE_KEY);
    } catch {
      /* storage blocked: fall back to the browser language */
    }
    const locale = detectLocale(stored, typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]));
    apply(locale);
    set({ locale });
  },
  setLocale: (locale) => {
    if (!isLocale(locale)) return;
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      /* the choice lasts for this session only */
    }
    apply(locale);
    set({ locale });
  },
}));

/** Translate outside React (labels built by pure helpers). Components should call `useT()` so they re-render when the language changes. */
export const tr = (key: MessageKey, vars?: Vars): string => translate(useLocaleStore.getState().locale, key, vars);

export function useT(): (key: MessageKey, vars?: Vars) => string {
  const locale = useLocaleStore((s) => s.locale);
  return (key, vars) => translate(locale, key, vars);
}
