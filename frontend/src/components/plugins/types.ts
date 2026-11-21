/** What the sidecar's `/cordis/*` routes return (ADR 0071). The host's own address and token never reach the UI. */

export type HostState = "starting" | "running" | "unavailable" | "failed";
export type PluginState = "active" | "pending" | "failed" | "disabled" | "changed" | "unavailable";
export type Capability = "files" | "network" | "processes" | "credentials";
export type SourceKind = "npm" | "github" | "local";

export interface HostStatus {
  state: HostState;
  reason: string | null;
  restarts: number;
  node: string | null;
  hostLog: string[];
  plugins: number;
}

export interface PluginSource {
  kind: SourceKind;
  spec: string;
  version?: string | null;
  commit?: string;
  subdir?: string;
}

export interface PluginView {
  id: string;
  name: string;
  version: string;
  source: PluginSource;
  enabled: boolean;
  scripts: string[];
  runtime: string;
  capabilities: string[];
  state: PluginState;
  message: string | null;
  /** Only for GitHub sources. */
  shareLink?: string;
}

export interface FetchRequest {
  kind: SourceKind;
  spec: string;
  version?: string;
  commit?: string;
  subdir?: string;
}

export interface PackagePreview {
  name: string;
  version: string;
  runtime: string;
  runtimeDefaulted: boolean;
  capabilities: string[];
  capabilitiesDeclared: boolean;
  isolation: { enforced: string[]; notEnforced: string[] };
  scripts: string[];
  bundlePatchIgnored: boolean;
  digest: string;
  warning: { en: string; "pt-BR": string };
  unmetDependencies: string[];
  warnings: { code: string; dependencies?: string[] }[];
}

export interface FetchResult {
  fetchId: string;
  source: PluginSource;
  preview: PackagePreview;
}

export interface InstallRequest {
  fetch_id: string;
  accept: boolean;
  digest: string;
  scripts?: "do-not-run";
}
