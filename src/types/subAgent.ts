import type { Attachment } from './attachment';
import type { AgentRunTaskLedgerItem } from './agentRun';
import type { Message } from './message';

export type SubAgentStatus = 'running' | 'completed' | 'timeout' | 'error' | 'cancelled';
export type SubAgentCompletionState = 'verified_success' | 'blocked' | 'incomplete';
export type SubAgentTerminationCause =
  | 'completed'
  | 'app_restart'
  | 'timeout'
  | 'cancelled'
  | 'provider_failure'
  | 'tool_failure'
  | 'internal_failure'
  | 'preflight_rejected'
  | 'iteration_limit'
  | 'unknown';

export type SubAgentOutcomeReconciliationCode =
  | 'pending'
  | 'recorded_verified'
  | 'recorded_candidate'
  | 'memory_disabled'
  | 'source_scope_missing'
  | 'source_scope_mismatch'
  | 'source_context_missing'
  | 'invalid_identity'
  | 'write_failed'
  | 'retry_exhausted';

export interface SubAgentOutcomeReconciliationState {
  status: 'pending' | 'completed' | 'blocked';
  code: SubAgentOutcomeReconciliationCode;
  attemptCount: number;
  updatedAt: number;
  completedAt?: number;
  factIds?: string[];
}

export type SubAgentSandboxPolicy = 'full' | 'safe-only' | 'inherit';

export type SubAgentLaunchState = 'queued' | 'bootstrapping' | 'active' | 'finalizing' | 'terminal';

export type SubAgentLifecycleEvent = 'started' | 'completed' | 'timeout' | 'error' | 'cancelled';

export interface SubAgentActivityEntry {
  timestamp: number;
  kind: 'status' | 'tool' | 'result' | 'message';
  text: string;
}

export interface SubAgentSnapshot {
  sessionId: string;
  parentConversationId: string;
  parentSessionId?: string;
  agentRunId?: string;
  workstreamId?: string;
  name?: string;
  depth: number;
  startedAt: number;
  updatedAt: number;
  deadlineAt?: number;
  status: SubAgentStatus;
  terminationCause?: SubAgentTerminationCause;
  sandboxPolicy: SubAgentSandboxPolicy;
  launchState?: SubAgentLaunchState;
  output?: string;
  completionState?: SubAgentCompletionState;
  outcomeReconciliation?: SubAgentOutcomeReconciliationState;
  toolsUsed?: string[];
  iterations?: number;
  lastProgressAt?: number;
  modelResponsePendingSince?: number;
  currentActivity?: string;
  activeToolName?: string;
  activeToolStartedAt?: number;
  lastToolResultPreview?: string;
  activityLog?: SubAgentActivityEntry[];
  taskLedger?: AgentRunTaskLedgerItem[];
  artifacts?: Attachment[];
}

export type SubAgentMemoryFactKind =
  | 'semantic_fact'
  | 'episodic_event'
  | 'goal'
  | 'tool_result'
  | 'source'
  | 'decision'
  | 'risk'
  | 'artifact'
  | 'summary'
  | 'evidence_span'
  | 'agent_run'
  | 'gotcha';

export interface SubAgentMemoryBundleFact {
  factId: string;
  subjectId: string;
  predicate: string;
  objectText: string;
  memoryKind: SubAgentMemoryFactKind;
  sourceAuthority: string;
  sourceMessageId: string | null;
  sourceRunId: string | null;
  validAt: number;
}

export interface SubAgentMemoryBundleEpisode {
  episodeId: string;
  lane: 'current_thread' | 'cross_thread';
  summary: string;
  sourceEndMessageId: string;
  endedAt: number;
}

export interface SubAgentMemorySelectionScope {
  memoryConversationId: string;
  sourceThreadId: string;
  personaId: string;
  taskId: string | null;
}

/** Immutable, task-selected evidence passed to a worker instead of parent-vault access. */
export interface SubAgentMemoryBundle {
  version: 1;
  source: {
    memoryOwnerId: string;
    memoryConversationId: string;
    sourceThreadId: string;
    personaId: string;
    taskId: string | null;
  };
  createdAt: number;
  facts: SubAgentMemoryBundleFact[];
  episodes: SubAgentMemoryBundleEpisode[];
}

export interface SubAgentConfig {
  parentConversationId: string;
  prompt: string;
  initialMessages?: Message[];
  workspaceConversationId?: string;
  workspaceReadFallbackConversationId?: string;
  model?: string;
  providerId?: string;
  agentRunId?: string;
  workstreamId?: string;
  /**
   * What the scoping goal asks this worker to produce. Derived code-owned from that
   * goal's success criteria at spawn time; never model-supplied and never self-claimed.
   */
  deliverableKind?: 'effect' | 'information';
  memorySelectionScope?: SubAgentMemorySelectionScope;
  memoryBundle?: SubAgentMemoryBundle;
  inheritTools?: boolean;
  linkUnderstandingEnabled?: boolean;
  mediaUnderstandingEnabled?: boolean;
  maxIterations?: number;
  timeoutMs?: number;
  depth?: number;
  sandboxPolicy?: 'full' | 'safe-only' | 'inherit';
  announce?: boolean;
  parentSessionId?: string;
  systemPrompt?: string;
  name?: string;
  tools?: string[];
}

export interface SubAgentResult {
  sessionId: string;
  output: string;
  completionState?: SubAgentCompletionState;
  toolsUsed: string[];
  iterations: number;
  status: 'completed' | 'timeout' | 'error' | 'cancelled';
  terminationCause: SubAgentTerminationCause;
  error?: string;
  depth: number;
  artifacts?: Attachment[];
}
