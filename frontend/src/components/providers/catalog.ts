/**
 * Provider catalogue — the single source of truth for what each vendor *is*.
 *
 * Mirrors `backend/adapters/catalog.py`. Keep the two in step; the backend is
 * authoritative at runtime, this copy exists so the UI can render a provider
 * the user has not connected yet (and so the dev route runs with no backend).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THREE AXES AND NOT A LOGO GRID
 *
 * A single-vendor tool shows you a list of integrations because every row means
 * the same thing. OHarness holds a *wallet*: five vendors, six connections,
 * and three properties that differ per row and change what a harness is allowed
 * to do with it.
 *
 *   residence  — does inference happen on this machine or leave it?
 *   capability — can a node call it for a completion, or only delegate a task?
 *   billing    — a seat you already pay for, prepaid credits, or per-token spend?
 *
 * Those are fixed columns in the ledger. You scan down one, not across six.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type ProviderId = "anthropic" | "cursor" | "openai" | "ollama" | "openrouter";

/** Where the tokens are actually computed. */
export type Residence = "local" | "cloud";

/**
 * What a connection can be asked to do.
 *  chat  — single-shot / streaming completion. An LLM node can target it.
 *  agent — a whole task is delegated to a vendor-run agent loop. An LLM node
 *          CANNOT target it; only a Delegate node can.
 */
export type Capability = "chat" | "agent" | "embed";

export type Billing = "subscription" | "credits" | "metered" | "none";

/** How models are chosen for this provider — drives the whole model section. */
export type Catalogue =
  | "fixed" /* short vendor-published list                       */
  | "installed" /* whatever the daemon has pulled locally        */
  | "hosted" /* whatever the vendor hosts right now              */
  | "routed" /* multi-vendor market: search + a fallback chain   */
  | "agent-only"; /* no model choice at node level               */

export type Health = "live" | "setup" | "degraded" | "fault" | "probing";

export interface CredentialSpec {
  /**
   * `none` — this connection holds no secret at all.
   * `cli` — also no secret stored by this app; the connection rides whatever
   * session the vendor's own CLI is already logged into on this machine
   * (`claude login` / `cursor-agent login`). `where` names the login command
   * instead of a key-retrieval URL.
   */
  kind: "api-key" | "cli" | "none";
  /** Real, checkable prefix — used to catch a pasted key from the wrong vendor. */
  prefix?: string;
  /** Where the user gets one. Plain sentence, no marketing. */
  where: string;
  /** Environment variable the vendor's own tooling reads, for the CLI handoff. */
  env?: string;
}

export interface ProviderSpec {
  id: ProviderId;
  vendor: string;
  /** Two characters, mono, grey. Identity through form — hue is reserved for state. */
  monogram: string;
  /** `either` means the vendor is connected twice, once per residence. */
  residence: Residence | "either";
  capabilities: Capability[];
  billing: Billing;
  catalogue: Catalogue;
  credential: CredentialSpec;
  endpoint: { default: string; editable: boolean };
  /** One line, factual, present tense. Shown under the vendor name in the dossier. */
  summary: string;
  /** A constraint the user will otherwise discover the hard way. */
  caveat?: string;
  docs: string;
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  anthropic: {
    id: "anthropic",
    vendor: "Anthropic",
    monogram: "AN",
    residence: "cloud",
    capabilities: ["chat"],
    billing: "subscription",
    catalogue: "fixed",
    credential: {
      kind: "cli",
      where: "Run `claude login` (or open Claude Code once and sign in).",
    },
    endpoint: { default: "https://api.anthropic.com", editable: false },
    summary:
      "Claude models via the local `claude` CLI, non-interactive print mode. Runs on your Claude Pro/Max seat, not a metered API key.",
    caveat:
      "Tool execution is disabled on every call (`--tools \"\"`) — this connection answers chat completions, it does not run commands or touch files.",
    docs: "https://docs.anthropic.com",
  },

  cursor: {
    id: "cursor",
    vendor: "Cursor",
    monogram: "CU",
    residence: "cloud",
    capabilities: ["agent"],
    billing: "subscription",
    catalogue: "agent-only",
    credential: {
      kind: "cli",
      where: "Run `cursor-agent login` (or sign in once from the Cursor desktop app).",
    },
    endpoint: { default: "https://api.cursor.com", editable: false },
    summary:
      "The headless `cursor-agent` CLI, non-interactive print mode. Runs on your Cursor seat, not a metered API key.",
    caveat:
      "Cursor publishes no chat-completions endpoint — its CLI runs agents, not models. An LLM node cannot target this connection; a Delegate node can. Tool execution stays on for that delegated task (file/shell access), scoped to a pinned working directory.",
    docs: "https://cursor.com/docs/api",
  },

  openai: {
    id: "openai",
    vendor: "OpenAI",
    monogram: "OA",
    residence: "cloud",
    capabilities: ["chat", "embed"],
    billing: "subscription",
    catalogue: "fixed",
    credential: {
      kind: "cli",
      where: "Run `codex login` (or open the Codex app once and sign in).",
    },
    endpoint: { default: "https://api.openai.com/v1", editable: true },
    summary:
      "GPT models via the local `codex` CLI, non-interactive exec mode. Runs on your ChatGPT seat, not a metered API key.",
    caveat:
      "Shell commands the model chooses to run go through a read-only sandbox (`--sandbox read-only`) and a pinned working directory — this connection answers chat completions, it does not write files.",
    docs: "https://platform.openai.com/docs",
  },

  ollama: {
    id: "ollama",
    vendor: "Ollama",
    monogram: "OL",
    residence: "either",
    capabilities: ["chat", "embed"],
    billing: "none",
    catalogue: "installed",
    credential: {
      kind: "none",
      where: "The local daemon is unauthenticated. Ollama Cloud is a separate connection.",
      env: "OLLAMA_API_KEY",
    },
    // The bare daemon has no /v1 — that's Ollama's OpenAI-compat surface,
    // which is what every adapter call (probe included) actually speaks.
    endpoint: { default: "http://127.0.0.1:11434/v1", editable: true },
    summary: "The daemon on this machine. Nothing leaves the device; nothing is billed.",
    docs: "https://docs.ollama.com",
  },

  openrouter: {
    id: "openrouter",
    vendor: "OpenRouter",
    monogram: "OR",
    residence: "cloud",
    capabilities: ["chat"],
    billing: "credits",
    catalogue: "routed",
    credential: {
      kind: "api-key",
      prefix: "sk-or-",
      where: "openrouter.ai → Keys",
      env: "OPENROUTER_API_KEY",
    },
    endpoint: { default: "https://openrouter.ai/api/v1", editable: false },
    summary:
      "One key, many vendors. Pick the model this connection runs; OpenRouter routes it to a vendor that serves it.",
    caveat:
      "Prices and availability are set by the upstream vendor and move without notice.",
    docs: "https://openrouter.ai/docs",
  },
};

/**
 * The Ollama split is the interesting case in this app, so it gets an explicit
 * override rather than a `variant` flag threaded through the whole UI. Local and
 * Cloud speak the same wire protocol and share an adapter; they differ in every
 * property a person actually cares about.
 */
export const OLLAMA_CLOUD: ProviderSpec = {
  ...PROVIDERS.ollama,
  residence: "cloud",
  billing: "subscription",
  catalogue: "hosted",
  credential: {
    kind: "api-key",
    prefix: "",
    where: "ollama.com → Settings → API keys (or run `ollama signin`)",
    env: "OLLAMA_API_KEY",
  },
  endpoint: { default: "https://ollama.com", editable: false },
  summary:
    "ollama.com as a remote host — same API surface, models too large for this machine.",
  caveat:
    "A cloud model id looks identical to a local one. The residence stamp on the row is the only thing that tells you where the tokens were computed.",
};

/* ── Label tables ─────────────────────────────────────────────────────────── */

export const RESIDENCE_LABEL: Record<Residence, string> = {
  local: "this machine",
  cloud: "vendor cloud",
};

export const CAPABILITY_LABEL: Record<Capability, string> = {
  chat: "completion",
  agent: "delegation",
  embed: "embedding",
};

export const BILLING_LABEL: Record<Billing, string> = {
  subscription: "seat",
  credits: "credits",
  metered: "per token",
  none: "free",
};

export const HEALTH_LABEL: Record<Health, string> = {
  live: "live",
  setup: "needs setup",
  degraded: "degraded",
  fault: "error",
  probing: "probing",
};

/** Health → the one CSS custom property that row is allowed to use. */
export const HEALTH_INK: Record<Health, string> = {
  live: "var(--signal)",
  setup: "var(--ink-faint)",
  degraded: "var(--warn)",
  fault: "var(--fault)",
  probing: "var(--ink-dim)",
};

/**
 * Does a run on this provider need a model named up front? Mirrors the
 * sidecar's `_HTTP_ADAPTERS_REQUIRE_MODEL` (backend/providers/resolution.py):
 * the HTTP adapters (Ollama local/Cloud, OpenRouter) refuse a run with no
 * model, while the CLI adapters (Claude, Codex) fall back to their own default.
 */
export function requiresModel(spec: ProviderSpec): boolean {
  return spec.catalogue === "installed" || spec.catalogue === "hosted" || spec.catalogue === "routed";
}
