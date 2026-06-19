import type { MutableRefObject } from 'react';
import type { ThinkingLevel } from '../../thinking';
import type { Conversation, ConversationLogEntry } from '../../../types/conversation';
import type { LlmProviderConfig } from '../../../types/provider';
import type { ToolCall } from '../../../types/message';
import type {
  EnsureAgentRunFinalResponse,
  ResolvedFinalizationProviderContext,
  ResumeAgentRun,
  RunChatOptions,
} from './contracts';
import type { ForegroundRunRequestBootstrapResult } from './requestBootstrap';

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
  toolCalls?: ToolCall[];
  effectId?: any;
} & Record<string, unknown>;

export interface ForegroundConversationRunStoreActions {
  addMessage: (...args: any[]) => any;
  addToolCall: (...args: any[]) => any;
  appendAgentRunCheckpoint: (...args: any[]) => any;
  completeAgentRun: (...args: any[]) => any;
  setAgentRunPhase: (...args: any[]) => any;
  startAgentRun: (...args: any[]) => any;
  updateAgentRunAsyncWork: (...args: any[]) => any;
  updateAgentRunControlGraph: (...args: any[]) => any;
  updateAgentRunPlan: (...args: any[]) => any;
  updateAgentRunSummary: (...args: any[]) => any;
  updateMessage: (...args: any[]) => any;
  updateMessageAssistantMetadata: (...args: any[]) => any;
  updateMessageEffect: (...args: any[]) => any;
  updateMessageEnrichedContent: (...args: any[]) => any;
  updateMessageProviderReplay: (...args: any[]) => any;
  updateMessageReasoning: (...args: any[]) => any;
  updateToolCallStatus: (...args: any[]) => any;
  applyConversationCompaction: (...args: any[]) => any;
}

export interface ForegroundConversationRunRequestActions {
  abortForegroundRequestForConversation: (...args: any[]) => any;
  clearForegroundRequest: (...args: any[]) => any;
  isCurrentForegroundRequest: (...args: any[]) => boolean;
  registerForegroundRequest: (...args: any[]) => any;
  setStreamingMessageId: (...args: any[]) => any;
}

export interface ForegroundConversationRunStreamingActions {
  clearStreamingDraft: (...args: any[]) => any;
  mergeStreamingDraft: (...args: any[]) => any;
  updateStreamingDraft: (...args: any[]) => any;
}

export interface ForegroundConversationRunRefs {
  forceNextScrollRef: MutableRefObject<boolean>;
  pendingAgentRunAsyncResumesRef: MutableRefObject<Map<string, Promise<void>>>;
  pendingAgentRunFinalizationsRef: MutableRefObject<Map<string, Promise<string | undefined>>>;
  pendingAgentRunTerminalReviewsRef: MutableRefObject<Map<string, Promise<void>>>;
  runInvocationSequenceRef: MutableRefObject<number>;
  shouldAutoFollowRef: MutableRefObject<boolean>;
  streamingDraftsRef: MutableRefObject<Record<string, ForegroundStreamingDraft | undefined>>;
}

export interface ForegroundConversationRunHelpers {
  appendConversationLog: (conversationId: string, entry: ForegroundRunLogEntryInput) => void;
  clearPendingRunState: (runId: string) => void;
  clearTrackedRunCancellation: (conversationId: string, runId: string) => void;
  createId: () => string;
  ensureAgentRunFinalResponse: EnsureAgentRunFinalResponse;
  ensureCanonicalConversation: (options?: EnsureCanonicalConversationOptions) => string | null;
  getConversation: (conversationId: string) => Conversation | undefined;
  getConversations: () => Conversation[];
  getResumeAgentRun: () => ResumeAgentRun | null;
  recordConversationTurnMemory: (
    conversationId: string,
    activeChatProvider?: LlmProviderConfig,
  ) => void;
  requestPersistenceCheckpoint: (delayMs?: number) => void;
  setChatError: (message: string | null) => void;
}

export interface ForegroundConversationRunState {
  activeModel: string | null;
  activeProviderId: string | null;
  chatNoApiKeyMessage: string | null;
  chatNoModelMessage: string | null;
  chatNoProviderMessage: string | null;
  defaultConversationMode: Conversation['mode'];
  effectiveMode: Conversation['mode'];
  effectivePersonaId: string;
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
  finalizationProviderContext: ResolvedFinalizationProviderContext;
  getCurrentConversation: () => Conversation | undefined;
  guardRunCallback: () => boolean;
  isCurrentRunInvocation: () => boolean;
  model: string;
  options?: RunChatOptions;
  provider: LlmProviderConfig;
  shared: ExecuteForegroundConversationRunParams['context'];
}
