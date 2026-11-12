import { FAULT_CLASSES, type ProviderFaultClass } from "@/components/agent/chatProvider";
import type { MessageKey } from "@/i18n/translate";

/**
 * The one table of provider states: for each state, the words and the action
 * (R-PRV-21). The Providers list row, the dossier header, the chat combo and the
 * composer's call to action all read it through `nextStep` and `missingProviderAction`,
 * so a connection says the same thing, and offers the same fix, wherever it shows.
 *
 * Adding a failure class means adding it to `FAULT_CLASSES` (the type system then
 * demands a row here) and to both catalogues (`stateTable.test.ts` checks every key).
 * An expired CLI session is `cli-signin` (R-PRV-04): the same word and the same fix.
 */
export type ActionId =
  | "replaceKey"
  | "copyServe"
  | "checkEndpoint"
  | "testAgain"
  | "testLater"
  | "openBilling"
  | "copyLogin"
  | "openInstall"
  | "paste"
  | "turnOn"
  | "chooseModel"
  | "copyPull";

/** The label (the dossier button, the combo and composer text) and the short hint (after the status in a list row). */
export const ACTION_TEXT: Record<ActionId, { label: MessageKey; hint: MessageKey }> = {
  replaceKey: { label: "step.replaceKey", hint: "step.replaceKey.hint" },
  copyServe: { label: "step.copyServe", hint: "step.copyServe.hint" },
  checkEndpoint: { label: "step.checkEndpoint", hint: "step.checkEndpoint.hint" },
  testAgain: { label: "step.testAgain", hint: "step.testAgain.hint" },
  testLater: { label: "step.testLater", hint: "step.testLater.hint" },
  openBilling: { label: "step.openBilling", hint: "step.openBilling.hint" },
  copyLogin: { label: "step.copyLogin", hint: "step.copyLogin.hint" },
  openInstall: { label: "step.openInstall", hint: "step.openInstall.hint" },
  paste: { label: "step.paste", hint: "step.paste.hint" },
  turnOn: { label: "step.turnOn", hint: "step.turnOn.hint" },
  chooseModel: { label: "step.chooseModel", hint: "step.chooseModel.hint" },
  copyPull: { label: "step.copyPull", hint: "step.copyPull.hint" },
};

/** Failure classes: the status word and the action that fixes it. `nextStep` falls back to `testAgain`
    when the connection lacks what the action needs (no login command, no install page, no billing page). */
export const STATE_TABLE: Record<ProviderFaultClass, { status: MessageKey; action: ActionId }> = {
  "key-rejected": { status: "fault.keyRejected", action: "replaceKey" },
  unreachable: { status: "fault.unreachable", action: "checkEndpoint" },
  "rate-limited": { status: "fault.rateLimited", action: "testLater" },
  "out-of-credits": { status: "fault.outOfCredits", action: "openBilling" },
  "cli-signin": { status: "fault.signIn", action: "copyLogin" },
  "cli-missing": { status: "fault.notInstalled", action: "openInstall" },
  "cli-timeout": { status: "fault.cliTimeout", action: "testAgain" },
  "cli-error": { status: "fault.cliError", action: "testAgain" },
  unknown: { status: "fault.unknown", action: "testAgain" },
};

export const EMPTY_STATE_IDS = ["no-connection", "pick-provider", "agent-only", "open-providers"] as const;
export type EmptyStateId = (typeof EMPTY_STATE_IDS)[number];

/** Empty states: what the composer says when nothing can answer. `open-providers` is a connection that cannot
    answer for a cause this screen cannot name; its text takes the connection's `{label}`. */
export const EMPTY_TABLE: Record<EmptyStateId, { text: MessageKey; action: "connect" }> = {
  "no-connection": { text: "empty.noConnection", action: "connect" },
  "pick-provider": { text: "empty.pickProvider", action: "connect" },
  "agent-only": { text: "empty.agentOnly", action: "connect" },
  "open-providers": { text: "empty.openProviders", action: "connect" },
};

export { FAULT_CLASSES };
