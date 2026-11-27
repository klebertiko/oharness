import { detectLocale, type Locale } from "@/i18n/locale";

/** The language the document should wear before paint: a saved choice, else the browser. */
export function documentLang(stored: string | null | undefined, languages: readonly string[]): Locale {
  return detectLocale(stored ?? null, languages);
}
