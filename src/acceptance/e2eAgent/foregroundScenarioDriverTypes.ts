import type { IngestionJob } from '../../services/memory/ingestionQueue';
import type { RecordCompletedTurnForMemoryResult } from '../../services/memory/lifecycle';
import type { AgentRun, AgentRunControlGraphStatus, AgentRunStatus } from '../../types/agentRun';
import type { Conversation, ConversationMode } from '../../types/conversation';
import type { AssistantCompletionStatus, Message } from '../../types/message';
import type { LlmProviderConfig } from '../../types/provider';
import type { ConversationUsageSummary } from '../../types/usage';
import type {
  E2ENativeMobileFixtureStateSnapshot,
  E2ENativeMobileInvocationSnapshot,
} from './e2eNativeMobileFixtures';

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

export type ForegroundScenarioNativeEvidenceSnapshot = Readonly<{
  stateBefore: DeepReadonly<E2ENativeMobileFixtureStateSnapshot>;
  stateAfter: DeepReadonly<E2ENativeMobileFixtureStateSnapshot>;
  invocations: ReadonlyArray<DeepReadonly<E2ENativeMobileInvocationSnapshot>>;
}>;

export type ForegroundScenarioExecutionContextSnapshot = Readonly<{
  mode: ConversationMode;
  personaId: string;
}>;

export type ForegroundScenarioFinalAssistantSnapshot = Readonly<{
  messageId: string;
  text: string;
  timestamp: number;
  completionStatus: AssistantCompletionStatus;
  finishReason: string | null;
  terminalReason: string | null;
}>;

export type ForegroundScenarioCompletionSnapshot = Readonly<{
  assistantStatus: AssistantCompletionStatus | 'missing';
  executionCompleted: boolean;
  finalResponseCompleted: boolean;
  runStatus: AgentRunStatus | 'missing' | 'not_applicable';
  runCompleted: boolean | null;
  runCompletedAt: number | null;
  runTerminalReason: string | null;
  graphStatus: AgentRunControlGraphStatus | null;
  graphTerminalReason: string | null;
}>;

export type ForegroundScenarioTurnSnapshot = Readonly<{
  completion: ForegroundScenarioCompletionSnapshot;
  durationMs: number;
  error: string | null;
  finalAssistant: ForegroundScenarioFinalAssistantSnapshot | null;
  finalAssistantCandidateCount: number;
  memory: ReadonlyArray<ForegroundScenarioMemorySnapshot>;
  native: ForegroundScenarioNativeEvidenceSnapshot;
  messages: DeepReadonly<Message[]>;
  route: Readonly<{
    directive: ForegroundScenarioRouteDirective;
  }> &
    ForegroundScenarioExecutionContextSnapshot;
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
