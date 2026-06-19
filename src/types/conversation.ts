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

// 'chitchat' is the canonical value (renamed from 'direct' on 2026-04-29).
// Persisted state migration v8→v9 in useSettingsStore upgrades old 'direct'
// values; chatPersistence sanitizers do the same for `Conversation.mode`.
export type ConversationMode = 'agentic' | 'chitchat';

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
  mode?: ConversationMode;
  folderId?: string;
  tags?: string[];
  pinned?: boolean;
  usage?: ConversationUsageSummary;
  logs?: ConversationLogEntry[];
  agentRuns?: AgentRun[];
  activeAgentRunId?: string;
  workspaceTargetId?: string;

  parentConversationId?: string;
  isSideThread?: boolean;
  isCanonical?: boolean;
  archivedFromMigration?: boolean;
  personaEvents?: PersonaSwitchEvent[];
}
