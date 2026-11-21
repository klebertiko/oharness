import type { MessageKey } from "@/i18n/translate";

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
