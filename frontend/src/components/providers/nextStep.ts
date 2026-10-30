import { modelNotPulled, providerFault, providerReadiness } from "@/components/agent/chatProvider";
import { tr } from "@/i18n/store";
import { specOf, type Connection } from "./providerStore";

/**
 * The one thing that would make a connection answer runs, phrased as an
 * action - the Providers screen's presentation of `providerReadiness().missing`
 * and `providerFault()` (design.md § Provider stance: "pick anything, fix it in
 * place"). The list row shows `hint`; the dossier header shows `label` as its
 * single primary button. Readiness and the failure class are never re-derived
 * here.
 *
 * Wording matches the chat composer's `missingProviderAction` ("Paste an
 * Anthropic key" / "Turn on X"), so the same connection asks for the same
 * fix on every surface. `hint` is the short form that fits after the status
 * word in a narrow list row. Null when nothing is missing.
 *
 * A known failure class wins over `missing`: a signed-out CLI is "Sign-in
 * needed", not "Turn on", and carries its own `status` word.
 */
export type NextStep = {
  kind:
    | "paste"
    | "turnOn"
    | "retest"
    | "model"
    | "replaceKey"
    | "checkEndpoint"
    | "copy"
    | "link";
  label: string;
  hint: string;
  /** More specific status word than the generic one, when the failure class is known. */
  status?: string;
  /** `copy`: the command that goes to the clipboard. */
  copy?: string;
  /** `link`: where it opens (external). */
  href?: string;
  /** The action does not test by itself, so a "Test again" sits beside it. */
  thenRetest?: boolean;
};

function faultStep(c: Connection): NextStep | null {
  const fault = providerFault(c);
  if (!fault) return null;
  const spec = specOf(c);
  switch (fault) {
    case "key-rejected":
      return { kind: "replaceKey", label: tr("step.replaceKey"), hint: tr("step.replaceKey.hint"), status: tr("fault.keyRejected") };
    case "unreachable":
      if (c.provider === "ollama" && c.residence === "local") {
        return {
          kind: "copy",
          label: tr("step.copyServe"),
          hint: tr("step.copyServe.hint"),
          status: tr("fault.unreachable"),
          copy: "ollama serve",
          thenRetest: true,
        };
      }
      if (spec.endpoint.editable) {
        return { kind: "checkEndpoint", label: tr("step.checkEndpoint"), hint: tr("step.checkEndpoint.hint"), status: tr("fault.unreachable") };
      }
      return { kind: "retest", label: tr("step.testAgain"), hint: tr("step.testAgain.hint"), status: tr("fault.unreachable") };
    case "rate-limited":
      return { kind: "retest", label: tr("step.testLater"), hint: tr("step.testLater.hint"), status: tr("fault.rateLimited") };
    case "out-of-credits":
      return spec.billingUrl
        ? { kind: "link", label: tr("step.openBilling"), hint: tr("step.openBilling.hint"), status: tr("fault.outOfCredits"), href: spec.billingUrl, thenRetest: true }
        : { kind: "retest", label: tr("step.testAgain"), hint: tr("step.testAgain.hint"), status: tr("fault.outOfCredits") };
    case "cli-signin": {
      const login = spec.credential.login;
      return login
        ? { kind: "copy", label: tr("step.copyLogin", { login }), hint: tr("step.copyLogin.hint"), status: tr("fault.signIn"), copy: login, thenRetest: true }
        : { kind: "retest", label: tr("step.testAgain"), hint: tr("step.testAgain.hint"), status: tr("fault.signIn") };
    }
    case "cli-missing": {
      const url = spec.credential.installUrl;
      return url
        ? { kind: "link", label: tr("step.openInstall"), hint: tr("step.openInstall.hint"), status: tr("fault.notInstalled"), href: url, thenRetest: true }
        : { kind: "retest", label: tr("step.testAgain"), hint: tr("step.testAgain.hint"), status: tr("fault.notInstalled") };
    }
    case "unknown":
      return { kind: "retest", label: tr("step.testAgain"), hint: tr("step.testAgain.hint"), status: tr("fault.unknown") };
  }
}

export function nextStep(c: Connection): NextStep | null {
  const fault = faultStep(c);
  if (fault) return fault;
  switch (providerReadiness(c).missing) {
    case "credential": {
      const vendor = specOf(c).vendor;
      const article = /^[aeiou]/i.test(vendor) ? "an" : "a";
      return { kind: "paste", label: tr("step.paste", { article, vendor }), hint: tr("step.paste.hint") };
    }
    case "turn-on":
      return { kind: "turnOn", label: tr("step.turnOn"), hint: tr("step.turnOn.hint") };
    case "model":
      return { kind: "model", label: tr("step.chooseModel"), hint: tr("step.chooseModel.hint") };
    case "model-not-pulled": {
      const id = modelNotPulled(c);
      if (!id) return null;
      return {
        kind: "copy",
        label: tr("step.copyPull", { id }),
        hint: tr("step.copyPull.hint"),
        status: tr("status.modelNotPulled"),
        copy: `ollama pull ${id}`,
        thenRetest: true,
      };
    }
    case "fix-failure":
      return { kind: "retest", label: tr("step.testAgain"), hint: tr("step.testAgain.hint") };
    default:
      return null;
  }
}

/** How far a connection is from answering a run, nearest first. Null when nothing is missing.
    0 pick a model (none chosen, or the default is not pulled) · 1 flip the switch ·
    2 fix a failure (key, endpoint, retry, sign in) · 3 obtain something (install a CLI, get a key). */
export function distanceToReady(c: Connection): number | null {
  const step = nextStep(c);
  if (!step) return null;
  switch (step.kind) {
    case "model":
      return 0;
    case "turnOn":
      return 1;
    case "paste":
      return 3;
    case "link":
      return providerFault(c) === "cli-missing" ? 3 : 2;
    case "copy":
      // `ollama pull` for an unpulled default is one command away; a login or `ollama serve` is a failure to fix.
      return providerFault(c) ? 2 : 0;
    default:
      return 2;
  }
}

/** The connection nearest to ready among those that cannot answer yet, in list order on ties. */
export function closestToReady(connections: Connection[]): Connection | null {
  let best: { c: Connection; d: number } | null = null;
  for (const c of connections) {
    const d = distanceToReady(c);
    if (d !== null && (best === null || d < best.d)) best = { c, d };
  }
  return best?.c ?? null;
}

/** The step's words with the connection it belongs to, for places that show it away from its row
    (the composer's call to action): "Turn on · Anthropic". The label alone when it already names the vendor. */
export function stepText(c: Connection, step: NextStep): string {
  const names = [c.label, specOf(c).vendor].filter((n) => n.length >= 3).map((n) => n.toLowerCase());
  const label = step.label.toLowerCase();
  return names.some((n) => label.includes(n)) ? step.label : `${step.label} · ${c.label}`;
}
