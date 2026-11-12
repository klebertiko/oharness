import { isChatCapable, pickChatProvider } from "@/components/agent/chatProvider";
import { closestToReady, nextStep, stepText, type NextStep } from "./nextStep";
import type { Connection } from "./providerStore";
import { EMPTY_TABLE } from "./stateTable";
import { tr } from "@/i18n/store";

/** What the composer tells the person when `pickChatProvider` came back null:
    never a bare "Unavailable" (design.md § Provider stance). Null once a provider
    resolves, so a caller can render this in place of the send affordance without a
    separate `!provider` check drifting out of sync.

    The words are the connection's next step (`nextStep`), the same ones its list row,
    its dossier and the combo's Needs action group use. An explicit choice is fixed in
    place; with Auto, it is the connection nearest to ready. `id` is the connection to
    open in Providers, or null when there is nothing concrete (no connection at all, or a
    choice that no longer exists), in which case the caller opens the combo. `step` is
    the step itself, so a click can do what the label says where that needs no form. */
export function missingProviderAction(
  connections: Connection[],
  chosenId?: string | null,
): { text: string; id: string | null; step?: NextStep } | null {
  if (pickChatProvider(connections, chosenId)) return null;
  const target = chosenId ? connections.find((c) => c.id === chosenId) : closestToReady(connections.filter(isChatCapable));
  if (!target) return { text: tr(EMPTY_TABLE[chosenId ? "pick-provider" : "no-connection"].text), id: null };
  if (!isChatCapable(target)) return { text: tr(EMPTY_TABLE["agent-only"].text), id: null };
  const step = nextStep(target);
  // No step on a connection that still cannot answer means the cause is not one this screen can name.
  if (!step) return { text: tr(EMPTY_TABLE["open-providers"].text, { label: target.label }), id: target.id };
  return { text: stepText(target, step), id: target.id, step };
}

/** Do what a step's label says when that needs no form: copy the command, open the page.
    Anything else (a key, an endpoint, a model) is done on the Providers page the click opens. */
export function performInPlace(step: NextStep | undefined): void {
  if (!step) return;
  if (step.kind === "copy" && step.copy) void navigator.clipboard?.writeText(step.copy).catch(() => undefined);
  else if (step.kind === "link" && step.href) window.open(step.href, "_blank", "noopener,noreferrer");
}
