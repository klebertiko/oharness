import { providerFault, providerReadiness } from "@/components/agent/chatProvider";
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
      return { kind: "replaceKey", label: "Replace key", hint: "replace key", status: "Key rejected" };
    case "unreachable":
      if (c.provider === "ollama" && c.residence === "local") {
        return {
          kind: "copy",
          label: "Copy `ollama serve`",
          hint: "start Ollama",
          status: "Unreachable",
          copy: "ollama serve",
          thenRetest: true,
        };
      }
      if (spec.endpoint.editable) {
        return { kind: "checkEndpoint", label: "Check endpoint", hint: "check endpoint", status: "Unreachable" };
      }
      return { kind: "retest", label: "Test again", hint: "retest", status: "Unreachable" };
    case "rate-limited":
      return { kind: "retest", label: "Test again later", hint: "retry later", status: "Rate limited" };
    case "out-of-credits":
      return spec.billingUrl
        ? { kind: "link", label: "Open billing", hint: "add credit", status: "Out of credits", href: spec.billingUrl, thenRetest: true }
        : { kind: "retest", label: "Test again", hint: "retest", status: "Out of credits" };
    case "cli-signin": {
      const login = spec.credential.login;
      return login
        ? { kind: "copy", label: `Copy \`${login}\``, hint: "sign in", status: "Sign-in needed", copy: login, thenRetest: true }
        : { kind: "retest", label: "Test again", hint: "retest", status: "Sign-in needed" };
    }
    case "cli-missing": {
      const url = spec.credential.installUrl;
      return url
        ? { kind: "link", label: "Open install guide", hint: "install CLI", status: "Not installed", href: url, thenRetest: true }
        : { kind: "retest", label: "Test again", hint: "retest", status: "Not installed" };
    }
    case "unknown":
      return { kind: "retest", label: "Test again", hint: "retest", status: "Test failed" };
  }
}

export function nextStep(c: Connection): NextStep | null {
  const fault = faultStep(c);
  if (fault) return fault;
  switch (providerReadiness(c).missing) {
    case "credential": {
      const vendor = specOf(c).vendor;
      const article = /^[aeiou]/i.test(vendor) ? "an" : "a";
      return { kind: "paste", label: `Paste ${article} ${vendor} key`, hint: "add key" };
    }
    case "turn-on":
      return { kind: "turnOn", label: "Turn on", hint: "turn on" };
    case "model":
      return { kind: "model", label: "Choose a model", hint: "choose model" };
    case "fix-failure":
      return { kind: "retest", label: "Test again", hint: "retest" };
    default:
      return null;
  }
}
