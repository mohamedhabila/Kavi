import {
  areAgentRunAsyncOperationsEqual,
  normalizeAgentRunAsyncOperations,
} from '../../services/agents/agentRunAsyncState';
import { buildAgentRunMobileControllerAsyncOperation } from '../../services/agents/mobileControllerAsyncOperation';
import {
  qualifyMobileControllerRecoveryCommand,
  type MobileControllerRecoveryCommand,
} from '../../services/executionJournal/mobileControllerRecoveryCommand';
import type { AgentRun, AgentRunControlGraphState } from '../../types/agentRun';
import { reduceAgentControlGraph } from './agentControlGraph';

export const MOBILE_CONTROLLER_RECOVERY_PROJECTION_REJECTION_REASONS = [
  'command_invalid',
  'owner_mismatch',
  'run_not_active',
  'graph_state_invalid',
  'pending_operation_conflict',
] as const;

export type MobileControllerRecoveryProjectionRejectionReason =
  (typeof MOBILE_CONTROLLER_RECOVERY_PROJECTION_REJECTION_REASONS)[number];

export type MobileControllerRecoveryProjectionResult =
  | {
      kind: 'projected';
      controlGraph: AgentRunControlGraphState;
    }
  | {
      kind: 'rejected';
      reason: MobileControllerRecoveryProjectionRejectionReason;
    };

function rejected(
  reason: MobileControllerRecoveryProjectionRejectionReason,
): MobileControllerRecoveryProjectionResult {
  return { kind: 'rejected', reason };
}

export function projectMobileControllerRecoveryToAgentRun(input: {
  conversationId: string;
  run: AgentRun;
  command: MobileControllerRecoveryCommand;
}): MobileControllerRecoveryProjectionResult {
  const command = qualifyMobileControllerRecoveryCommand(input.command);
  if (!command) return rejected('command_invalid');
  if (
    command.conversationId !== input.conversationId ||
    command.agentRunId !== input.run.id ||
    command.requestMessageId !== input.run.userMessageId
  ) {
    return rejected('owner_mismatch');
  }
  if (input.run.status !== 'running') return rejected('run_not_active');

  const graph = input.run.controlGraph;
  if (!graph || !['awaiting_tool_results', 'recovering', 'waiting_async'].includes(graph.status)) {
    return rejected('graph_state_invalid');
  }
  const ownsExpectedToolCall = graph.expectedToolCalls.some(
    (toolCall) =>
      toolCall.id === command.handoff.toolCallId && toolCall.name === 'mobile_ui_action',
  );
  const alreadyObservedToolCall = graph.observedToolResults.some(
    (result) => result.id === command.handoff.toolCallId,
  );
  if (!ownsExpectedToolCall || alreadyObservedToolCall) {
    return rejected('owner_mismatch');
  }

  const rawOperations = graph.asyncWork.pendingOperations;
  const existingOperations = normalizeAgentRunAsyncOperations(rawOperations);
  if (rawOperations.length > 0 && !existingOperations) {
    return rejected('graph_state_invalid');
  }
  const existing = existingOperations?.[0];
  if (
    graph.asyncWork.awaitingBackgroundWorkers ||
    graph.pendingAsyncCount !== rawOperations.length ||
    rawOperations.length > 1 ||
    (graph.status === 'waiting_async' && rawOperations.length !== 1) ||
    (rawOperations.length > 0 && graph.status !== 'waiting_async') ||
    (existing &&
      (existing.kind !== 'mobile-controller-handoff' ||
        existing.status !== 'running' ||
        JSON.stringify(existing.mobileControllerHandoff) !== JSON.stringify(command.handoff)))
  ) {
    return rejected('pending_operation_conflict');
  }

  const operation = buildAgentRunMobileControllerAsyncOperation({
    handoff: command.handoff,
    status: 'running',
    updatedAt: Math.max(command.updatedAt, existing?.updatedAt ?? 0),
  });
  if (!operation) return rejected('graph_state_invalid');
  if (
    graph.status === 'waiting_async' &&
    graph.pendingAsyncCount === 1 &&
    areAgentRunAsyncOperationsEqual(existingOperations, [operation])
  ) {
    return { kind: 'projected', controlGraph: graph };
  }

  const controlGraph = reduceAgentControlGraph(graph, [
    {
      type: 'ASYNC_WAITING',
      pendingAsyncCount: 1,
      pendingOperations: [operation],
      timestamp: Math.max(graph.updatedAt, operation.updatedAt),
    },
  ]);
  return controlGraph.status === 'waiting_async' &&
    controlGraph.pendingAsyncCount === 1 &&
    areAgentRunAsyncOperationsEqual(controlGraph.asyncWork.pendingOperations, [operation])
    ? { kind: 'projected', controlGraph }
    : rejected('graph_state_invalid');
}
