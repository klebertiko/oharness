import type { Connection } from "./providerStore";

/** Ollama names a model without a tag as `:latest`; compare on that basis.
    The tag is whatever follows a colon in the last path segment, so a registry
    `host:port/` prefix is not mistaken for one. */
const withTag = (id: string) => ((id.split("/").pop() ?? id).includes(":") ? id : `${id}:latest`);

/** What `ollama pull` accepts as a model name; anything else is never put on
    the clipboard (the default model is free text from the picker). */
const PULLABLE = /^[A-Za-z0-9][A-Za-z0-9._\-/:@]*$/;

/** The default model of a local Ollama whose own model list does not contain
    it: a run on this connection would fail on a model nobody pulled. Only the
    endpoint's list counts as evidence (`modelsFromEndpoint`), never the static
    catalog, and only while a probe has actually answered. Returns the id to
    pull, or null when there is nothing to pull. */
export function modelNotPulled(c: Connection): string | null {
  if (c.provider !== "ollama" || c.residence !== "local" || !c.modelsFromEndpoint) return null;
  if (!c.defaultModel || c.health === "fault" || c.health === "probing") return null;
  if (!PULLABLE.test(c.defaultModel)) return null;
  const wanted = withTag(c.defaultModel);
  return c.models.some((m) => withTag(m.id) === wanted) ? null : c.defaultModel;
}
