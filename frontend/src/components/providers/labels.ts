import type { MessageKey } from "@/i18n/translate";
import type { Billing, Capability } from "./catalog";

/** What the catalogue's axes are called to a person. The catalogue keeps its own English words for the dev route and the run binding. */
export const CAPABILITY_LABEL_KEY: Record<Capability, MessageKey> = {
  chat: "meta.chat",
  agent: "meta.agent",
  embed: "meta.embed",
};

export const BILLING_LABEL_KEY: Record<Billing, MessageKey> = {
  subscription: "meta.billing.subscription",
  credits: "meta.billing.credits",
  metered: "meta.billing.metered",
  none: "meta.billing.none",
};

/** The prose the catalogue holds per provider, keyed so a language can replace it. `ollama` split by residence. */
export const PROVIDER_TEXT_KEY = {
  anthropic: { summary: "provider.anthropic.summary", caveat: "provider.anthropic.caveat", where: "provider.anthropic.where" },
  cursor: { summary: "provider.cursor.summary", caveat: "provider.cursor.caveat", where: "provider.cursor.where" },
  openai: { summary: "provider.openai.summary", caveat: "provider.openai.caveat", where: "provider.openai.where" },
  ollama: { summary: "provider.ollama.summary", caveat: undefined, where: "provider.ollama.where" },
  ollamaCloud: { summary: "provider.ollamaCloud.summary", caveat: "provider.ollamaCloud.caveat", where: "provider.ollamaCloud.where" },
  openrouter: { summary: "provider.openrouter.summary", caveat: "provider.openrouter.caveat", where: "provider.openrouter.where" },
} as const satisfies Record<string, { summary: MessageKey; caveat: MessageKey | undefined; where: MessageKey }>;
