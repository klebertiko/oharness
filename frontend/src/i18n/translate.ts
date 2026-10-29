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
