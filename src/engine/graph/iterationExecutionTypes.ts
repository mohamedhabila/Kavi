import type { RequestFrame } from '../../services/agents/requestFrame';
import type { GraphObservabilityAuditType } from './graphObservability';
import type { AgentRunControlGraphState } from '../../types/agentRun';
import type {
  AssistantMessageMetadata,
  Message,
  MessageProviderReplay,
  ToolCall,
} from '../../types/message';
import type { LlmProviderConfig } from '../../types/provider';
import type { OrchestratorState } from '../../types/conversation';
import type { TokenUsage } from '../../types/usage';
import type { ToolDefinition } from '../../types/tool';
import type { LlmService } from '../../services/llm/LlmService';
import type { FailoverState } from '../failover';
import type { IterationProgressSignature, ToolCallRecord } from '../loopDetection';
import type { OrchestratorCompactionEvent } from '../orchestratorCompaction';
import type { TrackedAsyncOperation } from '../pendingAsyncOperations';
import type { RuntimeToolAvailabilityContext } from '../tools/runtimeAvailability';
import type {
  AgentControlGraphEvent,
  AgentControlGraphSnapshot,
  AgentControlPerformance,
  AgentControlTurnDirectives,
} from './agentControlGraph';
import type { PrepareAgentControlGraphModelTurnParams } from './prepareAgentControlGraphModelTurn';
import type { AgentTurnCompactionEngine } from './agentTurnRequestBudget';
import type { AgentControlGraphWorkflowToolResultProgress } from './workflowToolResultProgress';
import type { ThinkingLevel } from '../thinking';
import type { CodeOwnedCurrentUserMessage } from '../tools/toolExecutionContext';
import type { VerifiedProcedureExecutionSession } from '../../services/memory/verifiedProcedure/executionSession';
import type { ToolMessageOutcome } from '../toolExecution/toolMessageOutcome';
import type { AdmittedSessionMemoryContext } from './sessionMemoryContext';
import type { ModelTurnMemoryPolicyBinding } from '../authority/modelTurnMemoryPolicyBinding';
import type { MobileControllerExecutionBinding } from '../mobileController/runtimeBinding';
import type { PersistedMobileControllerHandoff } from '../../services/executionJournal/mobileControllerHandoffStore';

export type IterationCallbacks = {
  onAssistantMessage: (
    content: string,
    toolCalls?: ToolCall[],
    providerReplay?: MessageProviderReplay,
    assistantCompletion?: AssistantMessageMetadata,
  ) => void;
  onAssistantStreamReset?: () => void;
  onReasoning?: (token: string) => void;
  onStateChange: (state: OrchestratorState) => void;
  onToken: (token: string) => void;
  onToolCallQueued?: (toolCall: ToolCall) => void;
  onToolCallStart: (toolCall: ToolCall) => void;
  onToolCallComplete: (toolCall: ToolCall) => void;
  onToolMessage: (outcome: ToolMessageOutcome) => void | Promise<void>;
};

export interface AgentControlGraphIterationRuntimeState {
  activeModel: string;
  activeProvider: LlmProviderConfig;
  admittedMemoryContext: AdmittedSessionMemoryContext;
  consecutivePendingAsyncNoToolTurns: number;
  lastPendingAsyncSignature: string;
  llm: LlmService;
  lastModelTurnMemoryPolicyBinding: ModelTurnMemoryPolicyBinding;
  lastModelTurnMemoryRetrievalEventId?: string;
  warningInjectedThisRound: boolean;
  workingMessages: Message[];
}

export type TerminalGraphEvent = Extract<
  AgentControlGraphEvent,
  { type: 'BLOCKED' } | { type: 'FINALIZED' } | { type: 'YIELDED' } | { type: 'CANCELLED' }
>;

export type FinalCandidateGraphEvent = Extract<
  AgentControlGraphEvent,
  { type: 'FINAL_CANDIDATE_READY' }
>;

export type PromptContextSupport = PrepareAgentControlGraphModelTurnParams['promptContextSupport'];
export type SessionPromptContextSupport = Omit<
  PromptContextSupport,
  | 'livingMemorySections'
  | 'livingMemoryReadEpoch'
  | 'livingMemoryAuthoritySnapshot'
  | 'livingMemoryValidUntil'
>;

export type GraphIterationBindings = {
  applyAgentControlGraphEvents: (
    events: ReadonlyArray<AgentControlGraphEvent>,
  ) => AgentRunControlGraphState;
  completedWorkflowToolNames: Set<string>;
  consumeOneShotTurnDirectives: (reason: string) => AgentControlGraphSnapshot;
  finishCancelled: () => Promise<void>;
  finishExistingTerminalSession: (sessionEndReason?: string) => Promise<void>;
  finishFailure: (error: Error) => Promise<void>;
  finishWithGraphFinalCandidateEvent: (params: {
    assistantMetadata: AssistantMessageMetadata;
    beforeAssistantDelivery?: () => void;
    content: string;
    graphEvent: FinalCandidateGraphEvent;
    providerReplay?: MessageProviderReplay;
    sessionEndReason?: string;
  }) => Promise<void>;
  finishWithGraphTerminalEvent: (params: {
    assistantMetadata: AssistantMessageMetadata;
    beforeAssistantDelivery?: () => void;
    content: string;
    graphEvent: TerminalGraphEvent;
    providerReplay?: MessageProviderReplay;
    sessionEndReason?: string;
  }) => Promise<void>;
  finishWaitingForUserInput: (params: {
    assistantMetadata: AssistantMessageMetadata;
    beforeAssistantDelivery?: () => void;
    content: string;
    graphEvent: Extract<AgentControlGraphEvent, { type: 'USER_INPUT_REQUIRED' }>;
    sessionEndReason?: string;
  }) => Promise<void>;
  getCurrentTurnDirectives: () => AgentControlTurnDirectives;
  getGraphSnapshot: () => AgentControlGraphSnapshot;
  publishWorkflowToolResultProgressToAgentControlGraph: (params: {
    reason: string;
    toolMessage: Message;
    tools: ToolDefinition[];
  }) => AgentControlGraphWorkflowToolResultProgress;
  recordPerformanceMetrics: (
    metrics: Partial<AgentControlPerformance>,
    reason: string,
  ) => AgentControlGraphSnapshot;
  recordObservability: (params: {
    observabilityType: GraphObservabilityAuditType;
    iteration?: number;
    detail?: string;
    timestamp?: number;
  }) => AgentControlGraphSnapshot;
  recordPostToolFinalTextDirective: (params: {
    hasBackgroundLaunchWithoutWait?: boolean;
    hasAsyncTerminalResolution?: boolean;
    hasActivePersistentGoal?: boolean;
    hasCompletedBlockingGoal?: boolean;
    hasIncompleteBlockingGoal?: boolean;
    pendingAsyncCount: number;
  }) => boolean;
  recordTurnDirectives: (
    directives: Partial<AgentControlTurnDirectives>,
    reason: string,
  ) => AgentControlGraphSnapshot;
  resetIncompleteFinalTextRecovery: (reason: string) => AgentControlGraphSnapshot;
  syncPendingAsyncOperationsToGraph: () => void;
};

export type ToolRuntimeBindings = {
  availableToolNames: ReadonlySet<string>;
  catalogVisibleToolNames: ReadonlySet<string>;
  currentUserMessage?: CodeOwnedCurrentUserMessage;
  memoryConversationId: string;
  runtimeToolAvailability: RuntimeToolAvailabilityContext;
  toolCallHistory: ToolCallRecord[];
  stagnationSignatures: IterationProgressSignature[];
  explicitToolSurfaceToolNames?: ReadonlyArray<string>;
  toolFilter?: (toolName: string) => boolean;
  workspaceConversationId?: string;
  workspaceReadFallbackConversationId?: string;
  mobileController?: MobileControllerExecutionBinding;
};

export interface ExecuteAgentControlGraphIterationParams {
  allProviders?: LlmProviderConfig[];
  allTools: ReadonlyArray<ToolDefinition>;
  agentRunId?: string;
  executionRunId: string;
  beforeEffectDispatch?: (toolName: string) => Promise<void>;
  publishMobileControllerHandoff?: (handoff: PersistedMobileControllerHandoff) => Promise<void>;
  verifiedProcedureSession?: VerifiedProcedureExecutionSession;
  callbacks: IterationCallbacks;
  compactionEngine: AgentTurnCompactionEngine;
  conversationId: string;
  disableTooling?: boolean;
  emitPendingAsyncOperationsChange?: () => void;
  failoverState: FailoverState | null;
  graph: GraphIterationBindings;
  isSuperAgent: boolean;
  iteration: number;
  maxToolIterations: number;
  maxTokens: number;
  onCompaction?: (event: OrchestratorCompactionEvent) => void;
  onFinalizationHeld?: (params: {
    iteration: number;
    holdReason: string;
    missingRequiredEvidenceLabels: string[];
  }) => void;
  personaThinkingLevel?: ThinkingLevel;
  promptContextSupport: SessionPromptContextSupport;
  reportUsage: (usage: TokenUsage) => void;
  requestFrame: RequestFrame;
  runtime: AgentControlGraphIterationRuntimeState;
  signal?: AbortController;
  temperature?: number;
  thinkingLevel: ThinkingLevel;
  toolRuntime: ToolRuntimeBindings;
  trackedAsyncOperations: Map<string, TrackedAsyncOperation>;
  warn: (message: string, error: unknown) => void;
  yieldToUiFrame: () => Promise<void>;
}

export interface ExecuteAgentControlGraphIterationResult {
  runtime: AgentControlGraphIterationRuntimeState;
  status: 'continued' | 'finalized' | 'retry_current_iteration' | 'waiting';
}
