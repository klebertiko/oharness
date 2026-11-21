/** Facts the plugin screen and its store share. Machine values (names, digests, paths) stay as data. */

export type SourceKind = "npm" | "github" | "tarball" | "local";

export interface SourceRef {
  kind: SourceKind;
  spec: string;
  version?: string | null;
  commit?: string | null;
  subdir?: string | null;
}

export interface InspectedPackage {
  fetchId: string;
  name: string;
  version: string;
  source: SourceRef;
  scripts: readonly string[];
  runtime: string;
  capabilities: readonly string[];
  isolation: { enforced: readonly string[]; notEnforced: readonly string[] } | null;
  digest: string;
  unmetDependencies: readonly string[];
}

export interface PluginView {
  id: string;
  name: string;
  version: string;
  source: SourceRef;
  enabled: boolean;
  state: string;
  message?: string | null;
  scripts: readonly string[];
  runtime: string;
  capabilities: readonly string[];
  shareLink?: string;
}

/** One package. There is no field that approves scripts for a group. */
export interface InstallBody {
  fetchId: string;
  accept: true;
  digest: string;
  enable: boolean;
  scripts?: "do-not-run";
}

export interface MarketEntry {
  name: string;
  version: string;
  description: string;
  source: SourceRef;
}

export interface MarketIndex {
  version: 1;
  plugins: MarketEntry[];
  trust: "unreviewed";
}

export interface ShareResult {
  target: "npm" | "git";
  filename: string;
  index: MarketIndex;
  scriptsExecuted: false;
}

export interface CreatorAction {
  id: string;
  fetchId: string;
  name: string;
  version: string;
  summary: string;
  enable: boolean;
  status: "pending" | "approving" | "approved" | "rejected";
}

export interface ProposeInput {
  fetchId: string;
  digest: string;
  summary: string;
  scripts: "do-not-run" | null;
  name: string;
  version: string;
}

export interface DecideResult {
  applied: boolean;
  plugin?: PluginView;
}

export interface PluginsClient {
  fetch(source: SourceRef, signal: AbortSignal): Promise<InspectedPackage>;
  discard(fetchId: string): Promise<void>;
  install(body: InstallBody, onLog: (lines: string[]) => void): Promise<PluginView>;
  list(): Promise<PluginView[]>;
  status(): Promise<{ state: string; reason?: string | null }>;
  enable(id: string): Promise<PluginView>;
  disable(id: string): Promise<PluginView>;
  remove(id: string): Promise<void>;
  logs(id: string): Promise<string[]>;
  marketplace(url: string): Promise<MarketIndex>;
  share(id: string, target: "npm" | "git"): Promise<ShareResult>;
  apis(): Promise<{ id: string; access: "read" }[]>;
  writeStarter(folder: string, name: string, description: string): Promise<{ path: string; files: string[] }>;
  propose(input: ProposeInput): Promise<CreatorAction>;
  decide(id: string, decision: "approve" | "reject", enable: boolean): Promise<DecideResult>;
}
