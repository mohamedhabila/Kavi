import type { AgentGoal } from '../../types/agentRun';
import type { LlmProviderConfig } from '../../types/provider';
import type { Message, ToolCall } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';
import type { ToolCallRecord } from '../loopDetection';
import type { TrackedAsyncOperation } from '../pendingAsyncOperations';
import type { RuntimeToolAvailabilityContext } from '../tools/runtimeAvailability';
import type { RuntimeToolCallInput } from './toolExecutionMessages';

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
  conversationId: string;
  provider: LlmProviderConfig;
  allProviders?: LlmProviderConfig[];
  model: string;
  workspaceConversationId?: string;
  workspaceReadFallbackConversationId?: string;
  availableToolNames: ReadonlySet<string>;
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
};

export type ToolExecutionLifecycleResult = {
  toolCallId: string;
  toolMessage: Message;
  effectiveToolName: string;
  result?: string;
};
