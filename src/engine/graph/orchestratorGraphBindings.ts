import type { AgentRunControlGraphState } from '../../types/agentRun';
import type { LlmProviderConfig } from '../../types/provider';
import type { Message } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';
import type { OrchestratorCallbacks } from '../orchestrator';
import type { ToolCallRecord } from '../loopDetection';
import type { TrackedAsyncOperation } from '../pendingAsyncOperations';
import type { RuntimeToolAvailabilityContext } from '../tools/runtimeAvailability';
import { createAgentControlGraphRuntime } from './agentControlGraphRuntime';
import type { GraphIterationBindings } from './iterationExecutionTypes';
import type { AgentControlPerformance, AgentControlTurnDirectives } from './agentControlGraph';

type OrchestratorGraphBindingsParams = {
  callbacks: OrchestratorCallbacks;
  conversationId: string;
  initialMessages: ReadonlyArray<Message>;
  initialSnapshot?: AgentRunControlGraphState;
  workflowScopeUserMessageId?: string;
  trackedAsyncOperations: Map<string, TrackedAsyncOperation>;
  activeProvider: LlmProviderConfig;
  allProviders?: LlmProviderConfig[];
  activeModel: string;
  availableToolNames: ReadonlySet<string>;
  runtimeToolAvailability: RuntimeToolAvailabilityContext;
  toolCallHistory: ToolCallRecord[];
  signal?: AbortController;
  toolFilter?: (toolName: string) => boolean;
  workspaceConversationId?: string;
  workspaceReadFallbackConversationId?: string;
  emitPendingAsyncOperationsChange: () => void;
  warn: (message: string, error: unknown) => void;
};

export function createOrchestratorGraphBindings(
  params: OrchestratorGraphBindingsParams,
): GraphIterationBindings {
  const graphRuntime = createAgentControlGraphRuntime({
    callbacks: params.callbacks,
    conversationId: params.conversationId,
    initialMessages: params.initialMessages,
    initialSnapshot: params.initialSnapshot,
    workflowScopeUserMessageId: params.workflowScopeUserMessageId,
  });

  params.callbacks.onAgentControlGraphStateChange?.(graphRuntime.snapshot);
  return {
    applyAgentControlGraphEvents: (events) => graphRuntime.applyEvents(events),
    completedWorkflowToolNames: graphRuntime.completedWorkflowToolNames,
    consumeOneShotTurnDirectives: (reason) => graphRuntime.consumeOneShotTurnDirectives(reason),
    finishCancelled: () => graphRuntime.finishCancelled(),
    finishExistingTerminalSession: (sessionEndReason?: string) =>
      graphRuntime.finishExistingTerminalSession(sessionEndReason),
    finishFailure: (error: Error) => graphRuntime.finishFailure(error),
    finishWithGraphFinalCandidateEvent: (finalParams) =>
      graphRuntime.finishWithGraphFinalCandidateEvent(finalParams),
    finishWithGraphTerminalEvent: (terminalParams) =>
      graphRuntime.finishWithGraphTerminalEvent(terminalParams),
    getCurrentTurnDirectives: (): AgentControlTurnDirectives =>
      graphRuntime.getCurrentTurnDirectives(),
    getGraphSnapshot: () => graphRuntime.snapshot,
    publishWorkflowToolResultProgressToAgentControlGraph: (progressParams: {
      reason: string;
      toolMessage: Message;
      tools: ToolDefinition[];
    }) => graphRuntime.publishWorkflowToolResultProgress(progressParams),
    recordPerformanceMetrics: (metrics: Partial<AgentControlPerformance>, reason: string) =>
      graphRuntime.recordPerformanceMetrics(metrics, reason),
    recordObservability: (observabilityParams) =>
      graphRuntime.recordObservability(observabilityParams),
    recordPostToolFinalTextDirective: (directiveParams) =>
      graphRuntime.recordPostToolFinalTextDirective(directiveParams),
    recordTurnDirectives: (directives, reason) =>
      graphRuntime.recordTurnDirectives(directives, reason),
    resetIncompleteFinalTextRecovery: (reason) =>
      graphRuntime.resetIncompleteFinalTextRecovery(reason),
    syncPendingAsyncOperationsToGraph: () =>
      graphRuntime.syncPendingAsyncOperations(params.trackedAsyncOperations),
  };
}
