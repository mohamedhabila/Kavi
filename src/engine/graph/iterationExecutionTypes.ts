import type { RequestAssessmentAction } from '../../services/agents/requestGovernance';
import type { GraphObservabilityAuditType } from './graphObservability';
import type { LivingMemoryBridgeOutput } from '../../services/memory/livingMemoryBridge';
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
  onToolMessage: (toolCallId: string, result: string) => void | Promise<void>;
};

export interface AgentControlGraphIterationRuntimeState {
  activeModel: string;
  activeProvider: LlmProviderConfig;
  consecutivePendingAsyncNoToolTurns: number;
  lastPendingAsyncSignature: string;
  llm: LlmService;
  warningInjectedThisRound: boolean;
  workingMessages: Message[];
}

export type TerminalGraphEvent = Extract<
  AgentControlGraphEvent,
  { type: 'BLOCKED' } | { type: 'FINALIZED' } | { type: 'YIELDED' }
>;

export type FinalCandidateGraphEvent = Extract<
  AgentControlGraphEvent,
  { type: 'FINAL_CANDIDATE_READY' }
>;

export type PromptContextSupport = PrepareAgentControlGraphModelTurnParams['promptContextSupport'];

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
    content: string;
    graphEvent: FinalCandidateGraphEvent;
    providerReplay?: MessageProviderReplay;
    sessionEndReason?: string;
  }) => Promise<void>;
  finishWithGraphTerminalEvent: (params: {
    assistantMetadata: AssistantMessageMetadata;
    content: string;
    graphEvent: TerminalGraphEvent;
    providerReplay?: MessageProviderReplay;
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
  runtimeToolAvailability: RuntimeToolAvailabilityContext;
  toolCallHistory: ToolCallRecord[];
  stagnationSignatures: IterationProgressSignature[];
  useExplicitFilteredToolSurface?: boolean;
  toolFilter?: (toolName: string) => boolean;
  workspaceConversationId?: string;
  workspaceReadFallbackConversationId?: string;
};

export interface ExecuteAgentControlGraphIterationParams {
  allProviders?: LlmProviderConfig[];
  allTools: ReadonlyArray<ToolDefinition>;
  callbacks: IterationCallbacks;
  compactionEngine: AgentTurnCompactionEngine;
  conversationId: string;
  disableTooling?: boolean;
  emitPendingAsyncOperationsChange?: () => void;
  failoverState: FailoverState | null;
  graph: GraphIterationBindings;
  isSuperAgent: boolean;
  iteration: number;
  livingMemory?: LivingMemoryBridgeOutput | null;
  maxToolIterations: number;
  maxTokens: number;
  latestUserMessageText: string;
  onCompaction?: (event: OrchestratorCompactionEvent) => void;
  onFinalizationHeld?: (params: {
    iteration: number;
    holdReason: string;
    missingRequiredEvidenceLabels: string[];
  }) => void;
  personaThinkingLevel?: ThinkingLevel;
  promptContextSupport: PromptContextSupport;
  reportUsage: (usage: TokenUsage) => void;
  requestAction: RequestAssessmentAction;
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
  status: 'continued' | 'finalized';
}
