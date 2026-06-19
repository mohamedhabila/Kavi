import type {
  AgentRunAsyncOperation,
  AgentRunCheckpointKind,
  AgentRunControlGraphState,
  AgentRunEvidenceEntry,
  AgentRunPhaseKey,
  AgentRunPhaseStatus,
  AgentRunPlan,
  AgentRunStatus,
  AgentRunSummary,
  AgentRunTerminalReason,
} from '../types/agentRun';
import type {
  AssistantMessageMetadata,
  Message,
  MessageProviderReplay,
  ToolCall,
} from '../types/message';
import type {
  Conversation,
  ConversationLogKind,
  ConversationLogLevel,
  ConversationMode,
} from '../types/conversation';
import type { ConversationUsageSource, TokenUsage } from '../types/usage';
import type { SubAgentSnapshot } from '../types/subAgent';
import type { AgentRunEvidenceDraft } from '../services/agents/lifecycle/evidenceTypes';

export interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  isLoading: boolean;

  createConversation: (
    providerId: string,
    systemPrompt: string,
    modelOverride?: string,
    options?: { activate?: boolean; personaId?: string; mode?: ConversationMode },
  ) => string;
  getOrCreateCanonicalThread: (
    providerId: string,
    systemPrompt: string,
    modelOverride?: string,
    options?: { activate?: boolean; personaId?: string; mode?: ConversationMode },
  ) => string;
  createSideThread: (
    parentConversationId: string,
    options?: {
      title?: string;
      systemPrompt?: string;
      providerId?: string;
      modelOverride?: string;
      personaId?: string;
      mode?: ConversationMode;
      activate?: boolean;
    },
  ) => string | null;
  discardSideThread: (id: string) => boolean;
  setActiveConversation: (id: string | null) => void;
  deleteConversation: (id: string) => void;
  clearAllConversations: () => void;
  updateModelInConversation: (conversationId: string, providerId: string, model: string) => void;
  updatePersonaInConversation: (conversationId: string, personaId: string) => void;
  updateModeInConversation: (conversationId: string, mode: ConversationMode) => void;
  addMessage: (
    conversationId: string,
    message: Omit<Message, 'timestamp' | 'id'> & { id?: string },
  ) => void;
  applyConversationCompaction: (conversationId: string, messages: Message[]) => void;
  updateMessage: (conversationId: string, messageId: string, content: string) => void;
  updateMessageEnrichedContent: (
    conversationId: string,
    messageId: string,
    enrichedContent?: string,
  ) => void;
  updateMessageReasoning: (conversationId: string, messageId: string, reasoning: string) => void;
  updateMessageProviderReplay: (
    conversationId: string,
    messageId: string,
    providerReplay?: MessageProviderReplay,
  ) => void;
  updateMessageAssistantMetadata: (
    conversationId: string,
    messageId: string,
    assistantMetadata?: AssistantMessageMetadata,
  ) => void;
  updateMessageEffect: (
    conversationId: string,
    messageId: string,
    effectId?: Message['effectId'],
  ) => void;
  editMessage: (conversationId: string, messageId: string, newContent: string) => void;
  setLoading: (loading: boolean) => void;
  addToolCall: (conversationId: string, messageId: string, toolCall: ToolCall) => void;
  updateToolCallStatus: (
    conversationId: string,
    messageId: string,
    toolCallId: string,
    status: ToolCall['status'],
    payload?: { result?: string; error?: string; completedAt?: number; progressText?: string },
  ) => void;
  recordConversationUsage: (
    conversationId: string,
    usage: TokenUsage & {
      providerId?: string;
      source?: ConversationUsageSource;
      modality?: 'image';
      toolCallId?: string;
      sessionId?: string;
      parentSessionId?: string;
      agentRunId?: string;
      timestamp?: number;
      estimatedCost?: number;
    },
  ) => void;
  addConversationLog: (
    conversationId: string,
    entry: {
      title: string;
      detail?: string;
      level?: ConversationLogLevel;
      kind?: ConversationLogKind;
      timestamp?: number;
    },
  ) => void;
  startAgentRun: (
    conversationId: string,
    params: {
      userMessageId: string;
      goal: string;
      timestamp?: number;
      summary?: Partial<AgentRunSummary>;
    },
  ) => string;
  setAgentRunPhase: (
    conversationId: string,
    phase: AgentRunPhaseKey,
    params?: {
      status?: Exclude<AgentRunPhaseStatus, 'pending'>;
      detail?: string;
      checkpointTitle?: string;
      checkpointDetail?: string;
      checkpointKind?: AgentRunCheckpointKind;
      timestamp?: number;
      allowRegression?: boolean;
    },
    runId?: string,
  ) => void;
  appendAgentRunCheckpoint: (
    conversationId: string,
    entry: {
      kind?: AgentRunCheckpointKind;
      title: string;
      detail?: string;
      timestamp?: number;
    },
    runId?: string,
  ) => void;
  updateAgentRunSummary: (
    conversationId: string,
    patch: Partial<AgentRunSummary> & { latestSummary?: string; timestamp?: number },
    runId?: string,
  ) => void;
  updateAgentRunAsyncWork: (
    conversationId: string,
    params?: {
      awaitingBackgroundWorkers?: boolean;
      pendingOperations?: AgentRunAsyncOperation[];
      latestSummary?: string;
      checkpointTitle?: string;
      checkpointDetail?: string;
      checkpointKind?: AgentRunCheckpointKind;
      timestamp?: number;
    },
    runId?: string,
  ) => void;
  updateAgentRunControlGraph: (
    conversationId: string,
    controlGraph: AgentRunControlGraphState | undefined,
    runId?: string,
  ) => void;
  updateAgentRunPlan: (
    conversationId: string,
    patch: Partial<AgentRunPlan> & { timestamp?: number },
    runId?: string,
  ) => void;
  recordAgentRunEvidence: (
    conversationId: string,
    entries: AgentRunEvidenceDraft | AgentRunEvidenceDraft[],
    params?: { timestamp?: number },
    runId?: string,
  ) => AgentRunEvidenceEntry[] | undefined;
  completeAgentRun: (
    conversationId: string,
    params?: {
      status?: Exclude<AgentRunStatus, 'running'>;
      latestSummary?: string;
      summary?: Partial<AgentRunSummary>;
      checkpointTitle?: string;
      checkpointDetail?: string;
      checkpointKind?: AgentRunCheckpointKind;
      terminalReason?: AgentRunTerminalReason;
      timestamp?: number;
    },
    runId?: string,
  ) => void;
  recoverInterruptedAgentRuns: (
    activeSubAgents: SubAgentSnapshot[],
    params?: { timestamp?: number },
  ) => void;
}
