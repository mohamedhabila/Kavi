import { areAgentRunAsyncOperationsEqual } from '../../services/agents/agentRunAsyncState';
import { qualifyAgentRunMobileControllerHandoffRef } from '../../services/agents/mobileControllerAsyncOperation';
import type { AgentRun, AgentRunControlGraphState } from '../../types/agentRun';
import type { ToolMessageOutcome } from '../toolExecution/toolMessageOutcome';
import { decodeToolEffectReceipt } from '../../utils/toolEffectReceipt';
import { MOBILE_UI_ACTION_TOOL_NAME } from '../mobileController/contracts';
import { reduceAgentControlGraph } from './agentControlGraph';

export const MOBILE_CONTROLLER_OUTCOME_PROJECTION_REJECTION_REASONS = [
  'settlement_invalid',
  'run_not_active',
  'graph_state_invalid',
  'pending_operation_conflict',
] as const;

export type MobileControllerOutcomeProjectionRejectionReason =
  (typeof MOBILE_CONTROLLER_OUTCOME_PROJECTION_REJECTION_REASONS)[number];

export type MobileControllerOutcomeProjectionResult =
  | Readonly<{ kind: 'projected'; controlGraph: AgentRunControlGraphState }>
  | Readonly<{
      kind: 'rejected';
      reason: MobileControllerOutcomeProjectionRejectionReason;
    }>;

function rejected(
  reason: MobileControllerOutcomeProjectionRejectionReason,
): MobileControllerOutcomeProjectionResult {
  return { kind: 'rejected', reason };
}

function validToolMessage(value: ToolMessageOutcome): boolean {
  return (
    value.version === 1 &&
    Boolean(value.toolCallId.trim()) &&
    ['completed', 'failed'].includes(value.status) &&
    typeof value.content === 'string'
  );
}

export function projectMobileControllerOutcomeToAgentRun(input: {
  run: AgentRun;
  handoff: unknown;
  receipt: unknown;
  toolMessage: ToolMessageOutcome;
  settledAt: number;
}): MobileControllerOutcomeProjectionResult {
  const handoff = qualifyAgentRunMobileControllerHandoffRef(input.handoff);
  const receipt = decodeToolEffectReceipt(input.receipt);
  if (
    !handoff ||
    !receipt ||
    !validToolMessage(input.toolMessage) ||
    !Number.isSafeInteger(input.settledAt) ||
    input.settledAt < 0 ||
    receipt.toolName !== MOBILE_UI_ACTION_TOOL_NAME ||
    receipt.toolCallId !== handoff.toolCallId ||
    receipt.executionRunId !== handoff.executionRunId ||
    receipt.dispatchRunId !== handoff.effectRunId ||
    receipt.requestDigest !== handoff.actionDigest ||
    input.toolMessage.toolCallId !== handoff.toolCallId ||
    (input.toolMessage.status === 'completed') !==
      (receipt.executionState === 'completed' && receipt.effectState === 'applied')
  ) {
    return rejected('settlement_invalid');
  }
  if (input.run.status !== 'running') return rejected('run_not_active');

  const graph = input.run.controlGraph;
  if (!graph || graph.status !== 'waiting_async') {
    return rejected('graph_state_invalid');
  }
  if (
    graph.expectedToolCalls.length !== 1 ||
    graph.expectedToolCalls[0]?.id !== handoff.toolCallId ||
    graph.expectedToolCalls[0]?.name !== MOBILE_UI_ACTION_TOOL_NAME ||
    graph.observedToolResults.some((result) => result.id === handoff.toolCallId)
  ) {
    return rejected('graph_state_invalid');
  }

  const operations = graph.asyncWork.pendingOperations;
  const operation = operations[0];
  if (
    graph.asyncWork.awaitingBackgroundWorkers ||
    graph.pendingAsyncCount !== 1 ||
    operations.length !== 1 ||
    operation?.kind !== 'mobile-controller-handoff' ||
    operation.status !== 'running' ||
    !areAgentRunAsyncOperationsEqual(operations, [operation]) ||
    JSON.stringify(operation.mobileControllerHandoff) !== JSON.stringify(handoff)
  ) {
    return rejected('pending_operation_conflict');
  }

  const timestamp = Math.max(graph.updatedAt, input.settledAt);
  const controlGraph = reduceAgentControlGraph(graph, [
    {
      type: 'TOOL_RESULT_RECORDED',
      result: {
        id: handoff.toolCallId,
        name: MOBILE_UI_ACTION_TOOL_NAME,
        ...(input.toolMessage.status === 'failed' ? { failed: true } : {}),
        canonicalized: true,
        evidence: [receipt.receiptId],
      },
      timestamp,
    },
    {
      type: 'ASYNC_WAITING',
      pendingAsyncCount: 0,
      pendingOperations: [],
      timestamp,
    },
  ]);
  return controlGraph.status === 'ready' &&
    controlGraph.pendingAsyncCount === 0 &&
    controlGraph.asyncWork.pendingOperations.length === 0 &&
    controlGraph.expectedToolCalls.length === 0
    ? { kind: 'projected', controlGraph }
    : rejected('graph_state_invalid');
}
