import type { MessageKey } from "@/i18n/translate";
import type { ProviderFaultClass } from "@/components/agent/chatProvider";

/** Stable provider failure classes. Keep in step with `backend/providers/errors.py`. */
export const PROVIDER_ERROR_CODES = [
  "authentication",
  "cli_missing",
  "cli_signed_out",
  "usage_limit",
  "http_429",
  "overload",
  "timeout",
  "model_not_found",
  "model_not_pulled",
  "endpoint_unreachable",
  "content_policy",
  "budget_exceeded",
] as const;

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

/** Primary action id. HTTP 429 is its own row and uses the usage-limit action. */
export const PROVIDER_ERROR_ACTION: Record<ProviderErrorCode, string> = {
  authentication: "sign-in-or-replace-key",
  cli_missing: "install-cli",
  cli_signed_out: "sign-in",
  usage_limit: "wait-or-switch",
  http_429: "wait-or-switch",
  overload: "retry-later",
  timeout: "retry",
  model_not_found: "choose-model",
  model_not_pulled: "pull-model",
  endpoint_unreachable: "check-endpoint",
  content_policy: "rewrite",
  budget_exceeded: "raise-ceiling",
};

export function providerErrorText(code: ProviderErrorCode): { what: MessageKey; why: MessageKey; action: MessageKey } {
  return {
    what: `providers.error.${code}.what` as MessageKey,
    why: `providers.error.${code}.why` as MessageKey,
    action: `providers.error.${code}.action` as MessageKey,
  };
}

/** The `provider_failure` classes the sidecar emits, mapped like `classify_provider_error` in `errors.py`.
    `cli-error` has no row: it is a fault with no named cause, and is not forced into a nearby one. */
const FROM_WIRE: Record<string, ProviderErrorCode> = {
  authentication: "authentication",
  "cli-signin": "cli_signed_out",
  "cli-missing": "cli_missing",
  "cli-timeout": "timeout",
  timeout: "timeout",
  usage_limit: "usage_limit",
  overload: "overload",
  transport: "endpoint_unreachable",
  model_not_found: "model_not_found",
  model_not_pulled: "model_not_pulled",
  content_policy: "content_policy",
  budget_exceeded: "budget_exceeded",
};

/** The catalog row for a wire class, or null for anything outside the closed set. */
export function catalogCodeFromWire(value: unknown): ProviderErrorCode | null {
  return typeof value === "string" && Object.hasOwn(FROM_WIRE, value) ? FROM_WIRE[value] : null;
}

const FROM_FAULT: Partial<Record<ProviderFaultClass, ProviderErrorCode>> = {
  "key-rejected": "authentication",
  unreachable: "endpoint_unreachable",
  "rate-limited": "http_429",
  "cli-signin": "cli_signed_out",
  "cli-missing": "cli_missing",
  "cli-timeout": "timeout",
  usage_limit: "usage_limit",
  overload: "overload",
  timeout: "timeout",
};

/** The catalog row for a connection's failure class, or null when the class names no cause. */
export function catalogCodeFromFault(fault: ProviderFaultClass | null | undefined): ProviderErrorCode | null {
  return fault ? FROM_FAULT[fault] ?? null : null;
}
