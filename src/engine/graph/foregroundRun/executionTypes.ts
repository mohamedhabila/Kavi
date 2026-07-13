import type { MutableRefObject } from 'react';
import type { ThinkingLevel } from '../../thinking';
import type { ChatState } from '../../../store/chatStoreTypes';
import type {
  Conversation,
  ConversationLogEntry,
  ConversationMode,
} from '../../../types/conversation';
import type { LlmProviderConfig } from '../../../types/provider';
import type { Message, ToolCall } from '../../../types/message';
import type {
  EnsureAgentRunFinalResponse,
  ResolvedFinalizationProviderContext,
  ResumeAgentRun,
  RunChatOptions,
} from './contracts';
import type { ForegroundRunRequestBootstrapResult } from './requestBootstrap';
import type { ForegroundConversationExecutionContext } from './executionContext';
import type {
  ActivateForegroundModelExecutionInput,
  BeginForegroundModelExecutionInput,
  CompleteForegroundModelExecutionInput,
  ForegroundModelExecutionLease,
} from '../../../services/executionJournal/foregroundModelExecutionTypes';
import type { ModelProjectionOwner } from '../../../types/conversation';
import type {
  ModelProjectionClaimResult,
  ModelProjectionReleaseResult,
  OwnedModelProjectionMutationResult,
} from '../../../store/modelProjectionOwnership';
import type { RecordConversationTurnMemory } from '../../../services/memory/turnPublication';

export type EnsureCanonicalConversationOptions = {
  providerId?: string;
  model?: string;
  personaId?: string;
  mode?: 'agentic' | 'chitchat';
  activate?: boolean;
  reportMissingProvider?: boolean;
};

export type ForegroundRunLogEntryInput = {
  title: string;
  detail?: string;
  level?: ConversationLogEntry['level'];
  kind?: ConversationLogEntry['kind'];
  timestamp?: number;
};

export type ForegroundStreamingDraft = {
  content?: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  effectId?: Message['effectId'];
};

export type ForegroundConversationRunStoreActions = Pick<
  ChatState,
  | 'addMessage'
  | 'addToolCall'
  | 'appendAgentRunCheckpoint'
  | 'applyConversationCompaction'
  | 'completeAgentRun'
  | 'setAgentRunPhase'
  | 'startAgentRun'
  | 'transitionMessageMemoryPublication'
  | 'updateAgentRunAsyncWork'
  | 'updateAgentRunControlGraph'
  | 'updateAgentRunPlan'
  | 'updateAgentRunSummary'
  | 'updateMessage'
  | 'updateMessageAssistantMetadata'
  | 'updateMessageEffect'
  | 'updateMessageEnrichedContent'
  | 'updateMessageProviderReplay'
  | 'updateMessageReasoning'
  | 'updateToolCallStatus'
>;

export interface ForegroundConversationRunRequestActions {
  abortForegroundRequestForConversation: (conversationId: string, reason?: string) => boolean;
  clearForegroundRequest: (
    conversationId: string,
    requestId: string,
    abortController: AbortController,
  ) => boolean;
  isCurrentForegroundRequest: (
    conversationId: string,
    requestId: string,
    abortController: AbortController,
  ) => boolean;
  registerForegroundRequest: (
    requestId: string,
    conversationId: string,
    abortController: AbortController,
  ) => void;
  setStreamingMessageId: (
    conversationId: string,
    requestId: string,
    abortController: AbortController,
    messageId: string | null,
  ) => boolean;
}

export interface ForegroundConversationRunStreamingActions {
  clearStreamingDraft: (messageId: string) => void;
  mergeStreamingDraft: (messageId: string, patch: Partial<ForegroundStreamingDraft>) => void;
  updateStreamingDraft: (
    messageId: string,
    updater: (
      currentDraft: ForegroundStreamingDraft | undefined,
    ) => ForegroundStreamingDraft | undefined,
  ) => void;
}

export interface ForegroundConversationRunRefs {
  forceNextScrollRef: MutableRefObject<boolean>;
  pendingAgentRunAsyncResumesRef: MutableRefObject<Map<string, Promise<void>>>;
  pendingAgentRunFinalizationsRef: MutableRefObject<Map<string, Promise<string | undefined>>>;
  pendingAgentRunTerminalReviewsRef: MutableRefObject<Map<string, Promise<void>>>;
  shouldAutoFollowRef: MutableRefObject<boolean>;
  streamingDraftsRef: MutableRefObject<Record<string, ForegroundStreamingDraft | undefined>>;
}

export interface ForegroundConversationRunHelpers {
  appendConversationLog: (conversationId: string, entry: ForegroundRunLogEntryInput) => void;
  clearPendingRunState: (conversationId: string, runId: string) => void;
  clearTrackedRunCancellation: (conversationId: string, runId: string) => void;
  createId: () => string;
  ensureAgentRunFinalResponse: EnsureAgentRunFinalResponse;
  ensureCanonicalConversation: (options?: EnsureCanonicalConversationOptions) => string | null;
  getConversation: (conversationId: string) => Conversation | undefined;
  getConversations: () => Conversation[];
  getResumeAgentRun: () => ResumeAgentRun | null;
  recordConversationTurnMemory: RecordConversationTurnMemory;
  requestPersistenceCheckpoint: (delayMs?: number) => void;
  setChatError: (message: string | null) => void;
}

export interface ForegroundConversationRunState {
  activeModel: string | null;
  activeProviderId: string | null;
  chatNoApiKeyMessage: string | null;
  chatNoModelMessage: string | null;
  chatNoProviderMessage: string | null;
  defaultConversationMode: ConversationMode;
  exportDialogTitle: string;
  linkUnderstandingEnabled: boolean;
  maxLinks: number;
  mediaUnderstandingEnabled: boolean;
  providers: LlmProviderConfig[];
  streamStoreCheckpointIntervalMs: number;
  streamUiDraftPublishIntervalMs: number;
  systemPrompt: string;
  thinkingLevel: ThinkingLevel;
  toolResultPersistenceCheckpointDelayMs: number;
}

export interface ExecuteForegroundConversationRunParams {
  context: {
    durability: {
      createModelExecution: (
        input: BeginForegroundModelExecutionInput,
      ) => Promise<ForegroundModelExecutionLease>;
      activateModelExecution: (
        input: ActivateForegroundModelExecutionInput,
      ) => Promise<ForegroundModelExecutionLease>;
      claimModelProjection: (input: {
        conversationId: string;
        owner: ModelProjectionOwner;
        assistantMessage?: Message;
      }) => ModelProjectionClaimResult;
      completeModelExecution: (input: CompleteForegroundModelExecutionInput) => Promise<unknown>;
      flushChatState: () => Promise<void>;
      ownsModelProjection: (conversationId: string, owner: ModelProjectionOwner) => boolean;
      mutateModelProjection: <T>(input: {
        conversationId: string;
        owner: ModelProjectionOwner;
        mutate: (
          conversation: Conversation,
        ) =>
          | { kind: 'applied'; conversation: Conversation; value: T }
          | { kind: 'rejected'; value: T };
      }) => OwnedModelProjectionMutationResult<T>;
      releaseModelProjection: (input: {
        conversationId: string;
        owner: ModelProjectionOwner;
      }) => ModelProjectionReleaseResult;
      relinquishModelExecutionProcessOwnership: (runId: string) => void;
      waitForRecoveryReadiness: () => Promise<void>;
      waitForProjectionAvailability: (input: {
        conversationId: string;
        signal: AbortSignal;
      }) => Promise<void>;
    };
    helpers: ForegroundConversationRunHelpers;
    refs: ForegroundConversationRunRefs;
    requests: ForegroundConversationRunRequestActions;
    state: ForegroundConversationRunState;
    store: ForegroundConversationRunStoreActions;
    streaming: ForegroundConversationRunStreamingActions;
  };
  conversationId: string;
  options?: RunChatOptions;
}

export interface ForegroundConversationRunRuntimeParams {
  bootstrapResult: ForegroundRunRequestBootstrapResult;
  clearForegroundRequestIfCurrent: () => boolean;
  completeRunOnce: (task: () => Promise<void> | void) => Promise<void>;
  conversation: Conversation | undefined;
  conversationId: string;
  executionContext: ForegroundConversationExecutionContext;
  finalizationProviderContext: ResolvedFinalizationProviderContext;
  getCurrentConversation: () => Conversation | undefined;
  guardRunCallback: () => boolean;
  isCurrentRunInvocation: () => boolean;
  model: string;
  options?: RunChatOptions;
  provider: LlmProviderConfig;
  wrapResumeAgentRun: (
    resume: ResumeAgentRun | null,
    terminalStatus: 'succeeded' | 'failed',
  ) => ResumeAgentRun | null;
  shared: ExecuteForegroundConversationRunParams['context'];
}
