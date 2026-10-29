import { PROVIDER_TEXT_KEY } from "./labels";
import { specOf, type Connection } from "./providerStore";

/** Which prose block a connection reads: Ollama has one per residence. */
export function providerKey(c: Connection): keyof typeof PROVIDER_TEXT_KEY {
  const spec = specOf(c);
  if (spec.id === "ollama") return spec.catalogue === "hosted" ? "ollamaCloud" : "ollama";
  return spec.id;
}
