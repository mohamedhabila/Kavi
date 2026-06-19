import type { Attachment } from './attachment';
import type { AgentRunTaskLedgerItem } from './agentRun';
import type { Message } from './message';

export type SubAgentStatus = 'running' | 'completed' | 'timeout' | 'error' | 'cancelled';
export type SubAgentCompletionState = 'verified_success' | 'blocked' | 'incomplete';

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
  sandboxPolicy: SubAgentSandboxPolicy;
  launchState?: SubAgentLaunchState;
  output?: string;
  completionState?: SubAgentCompletionState;
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
  inheritMemory?: boolean;
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
  error?: string;
  depth: number;
  artifacts?: Attachment[];
}
