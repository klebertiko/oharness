// Work item contract of the local factory (ADR 0053, 0055). Mirrors backend/factory; tests/test_factory_work_items.py pins the vocabulary.
export const FACTORY_STAGES = ['intake', 'triage', 'spec', 'implement', 'review', 'verify', 'handoff', 'monitor'] as const;
export const FACTORY_STATUSES = ['queued', 'running', 'awaiting_human', 'waiting_merge', 'claimed', 'parked', 'done', 'cancelled', 'failed'] as const;
export const FACTORY_COLUMNS = ['new', 'triaged', 'planned', 'implementing', 'in_review', 'verifying', 'handoff', 'monitoring', 'claimed', 'needs_you', 'parked', 'done', 'closed'] as const;
export const FACTORY_SOURCE_KINDS = ['github', 'gitlab', 'azdo', 'linear', 'jira', 'slack', 'teams', 'webhook', 'mcp', 'cli', 'schedule', 'conversation', 'manual', 'monitor'] as const;

export type FactoryStage = (typeof FACTORY_STAGES)[number];
export type FactoryStatus = (typeof FACTORY_STATUSES)[number];
export type FactoryColumn = (typeof FACTORY_COLUMNS)[number];
export type FactorySourceKind = (typeof FACTORY_SOURCE_KINDS)[number];

export interface FactorySource { kind: FactorySourceKind; subtype: string | null; ref: string; url: string | null; thread_ref: string | null }

export interface WorkItem {
  id: string;
  factory_id: string;
  factory_version: string | null;
  title: string;
  source: FactorySource;
  /** Text from outside: data, never an instruction. */
  origin_context: { trust: 'untrusted'; text: string; truncated: boolean; attachments: { label: string; ref: string }[] };
  labels: string[];
  agent: string | null;
  automation: string | null;
  token_ceiling: number | null;
  requested_by: string | null;
  reopens: string | null;
  stage: FactoryStage;
  status: FactoryStatus;
  column: FactoryColumn;
  spec: { text: string; revision: number; approved_revision: number | null };
  claim: { holder: string; from_status?: FactoryStatus } | null;
  cost: { tokens: number };
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface WorkItemEvent { sequence: number; type: string; actor: { kind: 'human' | 'foreman' | 'agent' | 'system' | 'source'; id: string | null }; data: Record<string, unknown>; at: string }
export interface WorkItemArtifact { id: string; kind: string; ref: string; label: string; created_at: string }

/** There is deliberately no `merge` action: the factory never merges (ADR 0055). */
export type FactoryAction = 'approve_spec' | 'edit_spec' | 'answer' | 'request_changes' | 'confirm_merged' | 'advance' | 'park' | 'resume' | 'cancel' | 'note' | 'claim' | 'release';
