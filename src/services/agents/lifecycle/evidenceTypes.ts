import type {
  AgentRunEvidenceKind,
  AgentRunEvidenceRecorder,
  AgentRunEvidenceStatus,
} from '../../../types/agentRun';

export const MAX_AGENT_RUN_EVIDENCE_ENTRIES = 96;
export const MAX_AGENT_RUN_EVIDENCE_TAGS = 8;
export const MAX_EVIDENCE_READ_ENTRIES = 24;
export const MAX_EVIDENCE_CONTENT_CHARS = 400;

export const AGENT_RUN_EVIDENCE_KIND_VALUES: AgentRunEvidenceKind[] = [
  'fact',
  'source',
  'decision',
  'risk',
  'question',
  'artifact',
  'summary',
];

export const AGENT_RUN_EVIDENCE_STATUS_VALUES: AgentRunEvidenceStatus[] = [
  'candidate',
  'verified',
  'open',
  'resolved',
];

export const AGENT_RUN_EVIDENCE_RECORDER_VALUES: AgentRunEvidenceRecorder[] = [
  'supervisor',
  'worker',
  'pilot',
  'python',
  'tool',
  'system',
];

export interface AgentRunEvidenceDraft {
  id?: string;
  kind: AgentRunEvidenceKind;
  status?: AgentRunEvidenceStatus;
  recorder?: AgentRunEvidenceRecorder;
  title?: string;
  content: string;
  dedupeKey?: string;
  sourceName?: string;
  sourceUri?: string;
  toolName?: string;
  workerSessionId?: string;
  artifactWorkspacePath?: string;
  tags?: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface AgentRunEvidenceFilter {
  kinds?: AgentRunEvidenceKind[];
  statuses?: AgentRunEvidenceStatus[];
  recorders?: AgentRunEvidenceRecorder[];
  query?: string;
  limit?: number;
  includeContent?: boolean;
}
