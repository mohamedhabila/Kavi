import type { IngestionJob } from '../../services/memory/ingestionQueue';
import type { RecordCompletedTurnForMemoryResult } from '../../services/memory/lifecycle';
import type { AgentRun } from '../../types/agentRun';
import type { Conversation, ConversationMode } from '../../types/conversation';
import type { Message } from '../../types/message';
import type { LlmProviderConfig } from '../../types/provider';
import type { ConversationUsageSummary } from '../../types/usage';

export type ForegroundScenarioRouteDirective =
  | 'production_auto'
  | 'forced_chitchat'
  | 'forced_agentic';

export type ForegroundScenarioTurnInput = {
  content: string;
  route: ForegroundScenarioRouteDirective;
  maxTokens?: number;
  timeoutMs?: number;
  timestamp?: number;
};

export type ForegroundScenarioDriverInput = {
  provider: LlmProviderConfig;
  conversationId: string;
  conversationTitle: string;
  systemPrompt: string;
  initialMessages?: ReadonlyArray<Message>;
  defaultMode: ConversationMode;
  turns: ReadonlyArray<ForegroundScenarioTurnInput>;
  maxTokens?: number;
  timeoutMs?: number;
  memoryTimeoutMs?: number;
};

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlyArray<infer U>
    ? ReadonlyArray<DeepReadonly<U>>
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

export type ForegroundScenarioMemorySnapshot = Readonly<{
  enqueued: boolean;
  jobId: string | null;
  processed: boolean;
  status: IngestionJob['status'] | 'not_enqueued';
}>;

export type ForegroundScenarioTurnSnapshot = Readonly<{
  durationMs: number;
  error: string | null;
  memory: ReadonlyArray<ForegroundScenarioMemorySnapshot>;
  messages: DeepReadonly<Message[]>;
  route: Readonly<{
    directive: ForegroundScenarioRouteDirective;
    mode: ConversationMode;
    personaId: string;
  }>;
  run: DeepReadonly<AgentRun> | null;
  timedOut: boolean;
  turnIndex: number;
  usage: DeepReadonly<ConversationUsageSummary> | null;
  userMessageId: string;
}>;

export type ForegroundScenarioDriverResult = Readonly<{
  conversationId: string;
  finalConversation: DeepReadonly<Conversation>;
  turns: ReadonlyArray<ForegroundScenarioTurnSnapshot>;
}>;

export type ForegroundScenarioMemoryRecord = {
  promise: Promise<RecordCompletedTurnForMemoryResult>;
};

export function cloneAndFreeze<T>(value: T): DeepReadonly<T> {
  const clone = JSON.parse(JSON.stringify(value)) as T;

  const freeze = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object' || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate as Record<string, unknown>)) freeze(child);
    Object.freeze(candidate);
  };

  freeze(clone);
  return clone as DeepReadonly<T>;
}
