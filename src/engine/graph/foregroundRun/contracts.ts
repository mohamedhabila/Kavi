import { AgentRun, AgentRunAsyncOperation } from '../../../types/agentRun';
import { LlmProviderConfig } from '../../../types/provider';

export type ResolvedFinalizationProviderContext = {
  provider: LlmProviderConfig;
  model: string;
  systemPromptText: string;
  conversationId: string;
  personaId?: string;
  internalUserMessageCount?: number;
};

export type RunChatOptions = {
  reuseAgentRunId?: string;
  reuseAssistantDraft?: boolean;
  additionalSystemPrompt?: string;
  additionalUserPrompt?: string;
  disableTools?: boolean;
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

export type ResumeAgentRun = (params: {
  conversationId: string;
  runId: string;
  additionalSystemPrompt: string;
  additionalUserPrompt?: string;
  disableTools?: boolean;
  reuseAssistantDraft?: boolean;
  initialPendingAsyncOperations?: AgentRunAsyncOperation[];
}) => Promise<void>;
