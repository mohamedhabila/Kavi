import { AgentRun, AgentRunAsyncOperation } from '../../../types/agentRun';
import { LlmProviderConfig } from '../../../types/provider';
import type {
  MemoryContextStrategy,
  MemoryRetrievalStrategy,
} from '../../../services/memory/memoryAccessPolicy';

export type ResolvedFinalizationProviderContext = {
  provider: LlmProviderConfig;
  model: string;
  systemPromptText: string;
  conversationId: string;
  personaId?: string;
  internalUserMessageCount?: number;
};

export type RunChatOptions = {
  maxTokens?: number;
  reuseAgentRunId?: string;
  reuseAssistantDraft?: boolean;
  additionalSystemPrompt?: string;
  additionalUserPrompt?: string;
  disableTools?: boolean;
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
  memoryConversationId?: string;
  timestamp?: number;
  preferredAssistantMessageId?: string;
  signal?: AbortSignal;
}) => Promise<string | undefined>;

export type ResumeAgentRun = (params: {
  conversationId: string;
  runId: string;
  additionalSystemPrompt: string;
  additionalUserPrompt?: string;
  disableTools?: boolean;
  reuseAssistantDraft?: boolean;
  initialPendingAsyncOperations?: AgentRunAsyncOperation[];
}) => Promise<void>;
