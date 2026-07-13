import type { IngestionJob } from '../../services/memory/ingestionQueue';
import type { IngestionPersistenceReceipt } from '../../services/memory/ingestionReceiptStore';
import type { MemoryTurnPublicationResult } from '../../services/memory/turnPublication';
import type { AgentRun, AgentRunControlGraphStatus, AgentRunStatus } from '../../types/agentRun';
import type { Conversation, ConversationMode } from '../../types/conversation';
import type { AssistantCompletionStatus, Message } from '../../types/message';
import type { LlmProviderConfig } from '../../types/provider';
import type { ConversationUsageSummary } from '../../types/usage';
import type {
  ScopedMemoryEvidenceDelta,
  ScopedMemoryEvidenceSnapshot,
} from '../../services/memory/evidenceSnapshot';
import type {
  E2ENativeMobileFixtureStateSnapshot,
  E2ENativeMobileInvocationSnapshot,
} from './e2eNativeMobileFixtures';
import type { ForegroundScenarioRetrievalEvidence } from './foregroundScenarioRetrievalEvidence';
import type {
  MemoryContextStrategy,
  MemoryRetrievalStrategy,
} from '../../services/memory/memoryAccessPolicy';

export type ForegroundScenarioRouteDirective =
  | 'production_auto'
  | 'forced_chitchat'
  | 'forced_agentic';

export type ForegroundScenarioLifecycleBoundary = 'app_relaunch' | 'new_conversation';

export type ForegroundScenarioLifecycleSnapshot =
  | Readonly<{
      boundary: 'app_relaunch';
      chatStore: 'rehydrated';
      memoryStore: 'reopened';
    }>
  | Readonly<{
      boundary: 'new_conversation';
      chatStore: 'fresh_conversation';
      memoryStore: 'shared_global';
      previousConversationMessageCount: number;
      newConversationInitialMessageCount: 0;
    }>;

export type ForegroundScenarioTurnInput = {
  content: string;
  lifecycleBefore?: ForegroundScenarioLifecycleBoundary;
  route: ForegroundScenarioRouteDirective;
  selectedMode?: ConversationMode;
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
  /** Hard outer wall-clock deadline for the complete scenario, including memory settlement. */
  scenarioTimeoutMs: number;
  turns: ReadonlyArray<ForegroundScenarioTurnInput>;
  maxTokens?: number;
  timeoutMs?: number;
  memoryTimeoutMs?: number;
  disableLongTermMemory?: boolean;
  allowedToolNames?: ReadonlyArray<string>;
  beforeTurns?: (identity: {
    conversationId: string;
    workspaceConversationId: string;
  }) => Promise<void> | void;
  memoryRetrievalStrategy?: MemoryRetrievalStrategy;
  memoryContextStrategy?: MemoryContextStrategy;
  enableCompaction?: boolean;
};

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlyArray<infer U>
    ? ReadonlyArray<DeepReadonly<U>>
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

export type ForegroundScenarioMemorySnapshot = Readonly<{
  publication: DeepReadonly<MemoryTurnPublicationResult>;
  job: DeepReadonly<IngestionJob> | null;
  receipts: ReadonlyArray<DeepReadonly<IngestionPersistenceReceipt>>;
}>;

export type ForegroundScenarioMemoryTurnEvidence = Readonly<{
  delta: DeepReadonly<ScopedMemoryEvidenceDelta>;
}>;

export type ForegroundScenarioMemoryFinalState = DeepReadonly<ScopedMemoryEvidenceSnapshot>;

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

export type ForegroundScenarioUserSnapshot = Readonly<{
  messageId: string;
  text: string;
  timestamp: number;
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
  lifecycleBefore: ForegroundScenarioLifecycleSnapshot | null;
  memory: ReadonlyArray<ForegroundScenarioMemorySnapshot>;
  memoryEvidence: ForegroundScenarioMemoryTurnEvidence;
  native: ForegroundScenarioNativeEvidenceSnapshot;
  retrieval: DeepReadonly<ForegroundScenarioRetrievalEvidence>;
  messages: DeepReadonly<Message[]>;
  route: Readonly<{
    directive: ForegroundScenarioRouteDirective;
  }> &
    ForegroundScenarioExecutionContextSnapshot;
  run: DeepReadonly<AgentRun> | null;
  timedOut: boolean;
  turnIndex: number;
  usage: DeepReadonly<ConversationUsageSummary> | null;
  user: ForegroundScenarioUserSnapshot;
  userMessageId: string;
}>;

export type ForegroundScenarioDriverResult = Readonly<{
  conversationId: string;
  finalConversation: DeepReadonly<Conversation>;
  memoryFinalState: ForegroundScenarioMemoryFinalState;
  turns: ReadonlyArray<ForegroundScenarioTurnSnapshot>;
}>;

export type ForegroundScenarioMemoryRecord = {
  promise: Promise<MemoryTurnPublicationResult>;
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
