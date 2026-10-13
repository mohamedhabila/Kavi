import type { Message } from './message';
import type { ConversationUsageSummary } from './usage';
import type { AgentRun } from './agentRun';

export type ConversationLogLevel = 'info' | 'success' | 'warning' | 'error';

export type ConversationLogKind =
  | 'system'
  | 'state'
  | 'tool'
  | 'usage'
  | 'compaction'
  | 'command'
  | 'error';

export interface ConversationLogEntry {
  id: string;
  timestamp: number;
  level: ConversationLogLevel;
  kind: ConversationLogKind;
  title: string;
  detail?: string;
}

export type OrchestratorState = 'idle' | 'thinking' | 'responding' | 'error';

export interface PersonaSwitchEvent {
  id: string;
  /** Wall-clock timestamp (ms) when the switch happened. */
  at: number;
  /** Persona id active before the switch. Omitted on the very first switch from an undefined persona. */
  from?: string;
  /** Persona id active after the switch. */
  to: string;
}

/** Persisted exclusive owner of one conversation's in-flight model projection. */
export interface ModelProjectionOwner {
  surface: 'foreground' | 'scheduler';
  runId: string;
  requestMessageId: string;
  assistantMessageId: string;
  controlEpoch: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  providerId: string;
  modelOverride?: string;
  systemPrompt: string;
  createdAt: number;
  updatedAt: number;
  personaId?: string;
  usage?: ConversationUsageSummary;
  logs?: ConversationLogEntry[];
  agentRuns?: AgentRun[];
  activeAgentRunId?: string;
  workspaceTargetId?: string;
  modelProjectionOwner?: ModelProjectionOwner;

  personaEvents?: PersonaSwitchEvent[];
}
