import type { MessageKey } from "@/i18n/translate";
import { PROVIDER_TEXT_KEY } from "./labels";
import { specOf, type Connection } from "./providerStore";

/** Which prose block a connection reads: Ollama has one per residence. */
export function providerKey(c: Connection): keyof typeof PROVIDER_TEXT_KEY {
  const spec = specOf(c);
  if (spec.id === "ollama") return spec.catalogue === "hosted" ? "ollamaCloud" : "ollama";
  return spec.id;
}

const GENERIC_VENDOR_KEY: Partial<Record<string, MessageKey>> = {
  "openai-compatible": "provider.openaiCompatible.vendor",
  "anthropic-gateway": "provider.anthropicGateway.vendor",
};

/** The vendor's name as a person reads it. Brands are the same in every language; the two generic protocols are described, so they follow the language. */
export function vendorName(c: Connection, t: (key: MessageKey) => string): string {
  const spec = specOf(c);
  const key = GENERIC_VENDOR_KEY[spec.id];
  return key ? t(key) : spec.vendor;
}
