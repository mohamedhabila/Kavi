import type { AgentGoal } from '../../types/agentRun';
import type { LlmProviderConfig } from '../../types/provider';
import type { Message, ToolCall } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';
import type { ToolCallRecord } from '../loopDetection';
import type { TrackedAsyncOperation } from '../pendingAsyncOperations';
import type { RuntimeToolAvailabilityContext } from '../tools/runtimeAvailability';
import type { RuntimeToolCallInput } from './toolExecutionMessages';
import type { ToolEffectReceipt } from '../../types/toolEffectReceipt';
import type { CodeOwnedCurrentUserMessage } from '../tools/toolExecutionContext';
import type { VerifiedProcedureExecutionSession } from '../../services/memory/verifiedProcedure/executionSession';
import type { ModelTurnMemoryPolicyBinding } from '../authority/modelTurnMemoryPolicyBinding';
import type { ToolEffectDispatchObservation } from '../../services/executionJournal/toolEffectDispatchLifecycle';
import type { ToolObservedMemoryEvidenceCapability } from '../../services/memory/toolObservedMemoryEvidence';
import type { PersistedMobileControllerHandoff } from '../../services/executionJournal/mobileControllerHandoffStore';
import type { MobileControllerExecutionBinding } from '../mobileController/runtimeBinding';

export type ToolExecutionLifecycleIdPrefixes = {
  blocked: string;
  filtered: string;
  workflow: string;
  cancelled: string;
  success: string;
  error: string;
};

export type ToolExecutionLifecycleCallbacks = {
  onToolCallStart: (toolCall: ToolCall) => void;
  onToolCallComplete: (toolCall: ToolCall) => void;
};

export type ToolExecutionLifecycleMetricsRecorder = (
  metrics: { toolExecutionCount: number; toolExecutionDurationMs: number },
  reason: string,
) => void;

export type ToolExecutionLifecycleParams = {
  tc: RuntimeToolCallInput;
  iteration: number;
  batchIndex: number;
  conversationId: string;
  provider: LlmProviderConfig;
  allProviders?: LlmProviderConfig[];
  model: string;
  currentUserMessage?: CodeOwnedCurrentUserMessage;
  toolObservedMemoryEvidence?: ReadonlyArray<ToolObservedMemoryEvidenceCapability>;
  memoryConversationId: string;
  workspaceConversationId?: string;
  workspaceReadFallbackConversationId?: string;
  availableToolNames: ReadonlySet<string>;
  catalogVisibleToolNames?: ReadonlySet<string>;
  runtimeToolAvailability: RuntimeToolAvailabilityContext;
  toolCallHistory: ToolCallRecord[];
  groundedRequestScopedTools?: ReadonlyArray<ToolDefinition>;
  trackedAsyncOperations: Map<string, TrackedAsyncOperation>;
  signal?: AbortController;
  callbacks: ToolExecutionLifecycleCallbacks;
  workflowToolCallBlocker?: (toolName: string, argumentsText: string) => string | undefined;
  toolFilter?: (toolName: string) => boolean;
  pendingAsyncMonitorToolNames?: ReadonlySet<string>;
  usePerformanceMetrics: boolean;
  toolResultContextWindow?: number;
  idPrefixes: ToolExecutionLifecycleIdPrefixes;
  onPendingAsyncOperationsChange?: () => void;
  onRecordPerformanceMetrics?: ToolExecutionLifecycleMetricsRecorder;
  onBlockedBeforeExecution?: (detail: string, toolName: string) => void;
  controlGraphGoals?: ReadonlyArray<AgentGoal>;
  agentRunId?: string;
  executionRunId: string;
  modelTurnMemoryPolicyBinding: ModelTurnMemoryPolicyBinding;
  beforeEffectDispatch?: (toolName: string) => Promise<void>;
  mobileController?: MobileControllerExecutionBinding;
  verifiedProcedureSession?: VerifiedProcedureExecutionSession;
};

export type TerminalToolExecutionLifecycleResult = {
  toolCallId: string;
  toolMessage: Message;
  effectiveToolName: string;
  result?: string;
  effectReceipt?: ToolEffectReceipt;
  effectReconciliationRequired?: boolean;
  effectDispatchObservation?: ToolEffectDispatchObservation;
};

export type DeferredToolExecutionLifecycleResult = {
  toolCallId: string;
  effectiveToolName: string;
  deferredHandoff: PersistedMobileControllerHandoff;
  effectDispatchObservation: Extract<ToolEffectDispatchObservation, { kind: 'deferred' }>;
};

export type ToolExecutionLifecycleResult =
  | TerminalToolExecutionLifecycleResult
  | DeferredToolExecutionLifecycleResult;

export function isDeferredToolExecutionLifecycleResult(
  result: ToolExecutionLifecycleResult,
): result is DeferredToolExecutionLifecycleResult {
  return 'deferredHandoff' in result;
}
