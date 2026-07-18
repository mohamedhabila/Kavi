import { AgentRun, AgentRunAsyncOperation } from '../../../types/agentRun';
import { LlmProviderConfig } from '../../../types/provider';
import type {
  MemoryContextStrategy,
  MemoryRetrievalStrategy,
} from '../../../services/memory/memoryAccessPolicy';
import type { StructuredOutputOptions } from '../../../services/llm/support/contracts';

export type ResolvedFinalizationProviderContext = {
  provider: LlmProviderConfig;
  model: string;
  systemPromptText: string;
  conversationId: string;
  personaId?: string;
  internalUserMessageCount?: number;
};

export type AssistantDraftMode = 'continue' | 'new' | 'replace';

export type RunChatOptions = {
  maxTokens?: number;
  reuseAgentRunId?: string;
  assistantDraftMode?: AssistantDraftMode;
  additionalSystemPrompt?: string;
  additionalUserPrompt?: string;
  disableTools?: boolean;
  /**
   * Provider-enforced response schema for handing one action to a code-owned
   * external controller after this foreground turn. Requires disableTools.
   */
  externalActionContract?: StructuredOutputOptions;
  allowedToolNames?: ReadonlyArray<string>;
  memoryRetrievalStrategy?: MemoryRetrievalStrategy;
  memoryContextStrategy?: MemoryContextStrategy;
  enableCompaction?: boolean;
  initialPendingAsyncOperations?: AgentRunAsyncOperation[];
};

export type EnsureAgentRunFinalResponse = (params: {
  conversationId: string;
  runId: string;
  status: Exclude<AgentRun['status'], 'running'>;
  providerContext?: ResolvedFinalizationProviderContext;
  timestamp?: number;
  preferredAssistantMessageId?: string;
  signal?: AbortSignal;
}) => Promise<string | undefined>;

export type RecoverAgentRunFinalPreview = (
  status: Exclude<AgentRun['status'], 'running'>,
  timestamp?: number,
  preferredAssistantMessageId?: string,
  signal?: AbortSignal,
) => Promise<{ preview?: string; recovered: boolean; delivered: boolean }>;

export type ResumeAgentRun = (params: {
  conversationId: string;
  runId: string;
  additionalSystemPrompt: string;
  additionalUserPrompt?: string;
  disableTools?: boolean;
  assistantDraftMode: AssistantDraftMode;
  initialPendingAsyncOperations?: AgentRunAsyncOperation[];
}) => Promise<void>;
