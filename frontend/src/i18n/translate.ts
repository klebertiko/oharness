import { en, type MessageKey } from "./messages.en";
import { ptBR } from "./messages.pt-BR";
import type { Locale } from "./locale";

export type { MessageKey };
export type Vars = Record<string, string | number>;

const CATALOG: Record<Locale, Record<MessageKey, string>> = { en, "pt-BR": ptBR };

/** One message, `{name}` filled from `vars`. A key missing from a catalog falls back to English, never to the key. */
export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const text = CATALOG[locale][key] ?? en[key];
  return vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : text;
}

/** Keys written as `base.one` / `base.other` (and `base.few` etc. where a language needs them) form one plural message named `base`. */
export type PluralKey = MessageKey extends infer K ? (K extends `${infer B}.other` ? B : never) : never;

/** The plural form of `key` for `count` in `locale` (`Intl.PluralRules`); `{n}` is the formatted count, other `vars` fill as usual. Falls back to `.other`. */
export function translatePlural(locale: Locale, key: PluralKey, count: number, vars?: Vars): string {
  const rule = new Intl.PluralRules(locale).select(count);
  const pick = (k: string) => (k in CATALOG[locale] || k in en ? (k as MessageKey) : null);
  const resolved = pick(`${key}.${rule}`) ?? (`${key}.other` as MessageKey);
  return translate(locale, resolved, { ...vars, n: formatNumber(locale, count) });
}

export const formatNumber = (locale: Locale, n: number, options?: Intl.NumberFormatOptions): string => new Intl.NumberFormat(locale, options).format(n);

export const formatDate = (locale: Locale, d: Date | number, options?: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat(locale, options ?? { dateStyle: "medium", timeStyle: "short" }).format(d);
