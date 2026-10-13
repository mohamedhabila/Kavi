import type { AgentRun, AgentRunControlGraphStatus, AgentRunStatus } from '../../types/agentRun';
import type { Attachment } from '../../types/attachment';
import type { Conversation, ConversationMode } from '../../types/conversation';
import type { AssistantCompletionStatus, Message } from '../../types/message';
import type { LlmProviderConfig } from '../../types/provider';
import type { ConversationUsageSummary } from '../../types/usage';
import type {
  E2ENativeMobileFixtureStateSnapshot,
  E2ENativeMobileInvocationSnapshot,
} from './e2eNativeMobileFixtures';
import type {
  ForegroundScenarioMemoryItemsState,
  ForegroundScenarioMemoryPromptEvidence,
} from './foregroundScenarioMemoryItemsEvidence';

export type ForegroundScenarioRouteDirective =
  | 'production_auto'
  | 'forced_chitchat'
  | 'forced_agentic';

export type ForegroundScenarioLifecycleBoundary = 'app_relaunch' | 'context_reset';

/** The conversation whose memory a scenario turn reads and writes, and its chat thread. */
export type ForegroundScenarioMemoryScope = Readonly<{
  memoryConversationId: string;
  sourceThreadId: string;
}>;

export type ForegroundScenarioLifecycleSnapshot =
  | Readonly<{
      boundary: 'app_relaunch';
      chatStore: 'rehydrated';
      memoryStore: 'reopened';
    }>
  | Readonly<{
      boundary: 'context_reset';
      chatStore: 'context_archived';
      memoryStore: 'shared_global';
      previousLiveMessageCount: number;
      liveMessageCountAfter: 0;
    }>;

/**
 * Evaluator-owned: the user sends `content` while the turn's run is still working, once
 * the run has returned `afterToolResults` tool results — the composer's steering path.
 */
export type ForegroundScenarioSteerDirective = Readonly<{
  afterToolResults: number;
  content: string;
}>;

export type ForegroundScenarioTurnInput = {
  content: string;
  attachments?: ReadonlyArray<Attachment>;
  /** Evaluator-owned wall-clock pause before this turn; never interpreted by product code. */
  delayBeforeMs?: number;
  lifecycleBefore?: ForegroundScenarioLifecycleBoundary;
  route: ForegroundScenarioRouteDirective;
  selectedMode?: ConversationMode;
  maxTokens?: number;
  timeoutMs?: number;
  /** Evaluator-owned exact tool surface for this turn; overrides the scenario-level surface. */
  allowedToolNames?: ReadonlyArray<string>;
  timestamp?: number;
  steer?: ForegroundScenarioSteerDirective;
};

export function resolveForegroundScenarioAllowedToolNames(
  scenarioAllowedToolNames: ReadonlyArray<string> | undefined,
  turnAllowedToolNames: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> | undefined {
  return turnAllowedToolNames ?? scenarioAllowedToolNames;
}

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
  disableTools?: boolean;
  allowedToolNames?: ReadonlyArray<string>;
  beforeTurns?: (identity: {
    conversationId: string;
    workspaceConversationId: string;
  }) => Promise<void> | void;
  enableCompaction?: boolean;
};

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlyArray<infer U>
    ? ReadonlyArray<DeepReadonly<U>>
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

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
  /** False when background memory extraction did not finish before the turn's deadline. */
  memoryExtractionSettled: boolean;
  /** How long the turn waited for background extraction after its reply; part of `durationMs`. */
  memoryExtractionWaitMs: number;
  native: ForegroundScenarioNativeEvidenceSnapshot;
  memoryPrompt: ForegroundScenarioMemoryPromptEvidence;
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
  memoryItems: ForegroundScenarioMemoryItemsState;
  turns: ReadonlyArray<ForegroundScenarioTurnSnapshot>;
}>;

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
