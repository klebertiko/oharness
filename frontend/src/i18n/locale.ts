export const LOCALES = ["en", "pt-BR"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_KEY = "oharness-locale";
export const LOCALE_NAME: Record<Locale, string> = { en: "English", "pt-BR": "Português (Brasil)" };

export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);

/** A saved choice wins; otherwise the first browser language decides (any Portuguese reads as pt-BR); otherwise English. */
export function detectLocale(stored: string | null | undefined, languages: readonly string[]): Locale {
  if (isLocale(stored)) return stored;
  const first = languages.find((l) => /^(pt|en)\b/i.test(l));
  return first && /^pt/i.test(first) ? "pt-BR" : "en";
}
