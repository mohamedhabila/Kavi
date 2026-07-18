import { reduceAgentControlGraph } from '../../src/engine/graph/agentControlGraph';
import { buildStructuredToolEffectReceipt } from '../../src/engine/toolExecution/toolEffectReceipt';
import { buildAgentRunMobileControllerAsyncOperation } from '../../src/services/agents/mobileControllerAsyncOperation';
import { applyMobileControllerOutcomeInConversation } from '../../src/store/agentRuns/mobileControllerOutcome';
import type { ToolMessageOutcome } from '../../src/engine/toolExecution/toolMessageOutcome';
import { createPersistedMobileControllerHandoffFixture } from '../helpers/mobileControllerHandoffFixture';
import { makeTestAgentRun, makeTestConversation, makeTestMessage } from '../helpers/factories';

const persisted = createPersistedMobileControllerHandoffFixture();
const handoff = persisted.handoffRef;

function waitingGraph() {
  const operation = buildAgentRunMobileControllerAsyncOperation({
    handoff,
    status: 'running',
    updatedAt: 40,
  });
  if (!operation) throw new Error('expected mobile controller async operation');
  return reduceAgentControlGraph(undefined, [
    { type: 'MODEL_TURN_STARTED', iteration: 1, timestamp: 20 },
    {
      type: 'MODEL_TURN_COMPLETED',
      iteration: 1,
      toolCalls: [{ id: handoff.toolCallId, name: 'mobile_ui_action' }],
      timestamp: 30,
    },
    {
      type: 'ASYNC_WAITING',
      pendingAsyncCount: 1,
      pendingOperations: [operation],
      timestamp: 40,
    },
  ]);
}

async function settledOutcome() {
  const content = JSON.stringify({
    executionState: 'completed',
    effectState: 'applied',
    verificationState: 'verified',
  });
  const receipt = await buildStructuredToolEffectReceipt({
    toolCallId: handoff.toolCallId,
    toolName: 'mobile_ui_action',
    executionRunId: handoff.executionRunId,
    dispatchRunId: handoff.effectRunId,
    executionState: 'completed',
    effectKind: 'unknown',
    effectState: 'applied',
    verificationState: 'verified',
    requestDigest: handoff.actionDigest,
    resultText: content,
    recordedAt: 50,
  });
  const toolMessage: ToolMessageOutcome = {
    version: 1,
    toolCallId: handoff.toolCallId,
    status: 'completed',
    content,
  };
  return { receipt, toolMessage };
}

function waitingConversation() {
  return makeTestConversation({
    id: 'conversation-mobile-1',
    updatedAt: 40,
    messages: [
      makeTestMessage(1, {
        id: 'assistant-mobile-1',
        timestamp: 30,
        toolCalls: [
          {
            id: handoff.toolCallId,
            name: 'mobile_ui_action',
            arguments: JSON.stringify({ action: { kind: 'set_text', text: 'draft' } }),
            status: 'running',
            startedAt: 30,
            updatedAt: 40,
          },
        ],
      }),
    ],
    agentRuns: [
      makeTestAgentRun({
        id: 'agent-run-mobile-1',
        status: 'running',
        updatedAt: 40,
        controlGraph: waitingGraph(),
      }),
    ],
  });
}

describe('mobile controller outcome chat projection', () => {
  it('atomically completes the original call, appends one result, and readies the same run', async () => {
    const settlement = await settledOutcome();
    const result = applyMobileControllerOutcomeInConversation(waitingConversation(), {
      runId: 'agent-run-mobile-1',
      handoff,
      ...settlement,
      settledAt: 50,
    });

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') throw new Error(result.reason);
    expect(result.conversation.messages).toHaveLength(2);
    expect(result.conversation.messages[0]?.toolCalls?.[0]).toEqual(
      expect.objectContaining({
        id: handoff.toolCallId,
        status: 'completed',
        result: settlement.toolMessage.content,
        completedAt: 50,
        effectReceipts: [settlement.receipt],
      }),
    );
    expect(result.conversation.messages[1]).toEqual(
      expect.objectContaining({
        id: `assistant-mobile-1_tool_${handoff.toolCallId}`,
        role: 'tool',
        toolCallId: handoff.toolCallId,
        content: settlement.toolMessage.content,
        isError: false,
      }),
    );
    expect(result.conversation.messages[1]?.toolCalls?.[0]?.effectReceipts).toBeUndefined();
    expect(result.conversation.agentRuns?.[0]).toEqual(
      expect.objectContaining({
        id: 'agent-run-mobile-1',
        status: 'running',
        updatedAt: 50,
        controlGraph: expect.objectContaining({ status: 'ready', pendingAsyncCount: 0 }),
      }),
    );
    expect(result.conversation.agentRuns?.[0]?.controlGraph?.asyncWork.pendingOperations).toEqual(
      [],
    );
  });

  it('treats the exact callback replay as a no-op without duplicating the tool result', async () => {
    const settlement = await settledOutcome();
    const first = applyMobileControllerOutcomeInConversation(waitingConversation(), {
      runId: 'agent-run-mobile-1',
      handoff,
      ...settlement,
      settledAt: 50,
    });
    if (first.status !== 'applied') throw new Error(first.reason);
    const advancedConversation = {
      ...first.conversation,
      agentRuns: first.conversation.agentRuns?.map((run) => ({
        ...run,
        status: 'completed' as const,
        controlGraph: run.controlGraph
          ? { ...run.controlGraph, status: 'finalized' as const }
          : undefined,
      })),
    };

    const replay = applyMobileControllerOutcomeInConversation(advancedConversation, {
      runId: 'agent-run-mobile-1',
      handoff,
      ...settlement,
      settledAt: 50,
    });

    expect(replay).toEqual({ status: 'replayed', conversation: advancedConversation });
    expect(replay.status === 'replayed' ? replay.conversation : undefined).toBe(
      advancedConversation,
    );
  });

  it('rejects a conflicting callback after a result is already committed', async () => {
    const settlement = await settledOutcome();
    const first = applyMobileControllerOutcomeInConversation(waitingConversation(), {
      runId: 'agent-run-mobile-1',
      handoff,
      ...settlement,
      settledAt: 50,
    });
    if (first.status !== 'applied') throw new Error(first.reason);

    const conflictingContent = 'different result';
    const conflictingReceipt = await buildStructuredToolEffectReceipt({
      toolCallId: handoff.toolCallId,
      toolName: 'mobile_ui_action',
      executionRunId: handoff.executionRunId,
      dispatchRunId: handoff.effectRunId,
      executionState: 'completed',
      effectKind: 'unknown',
      effectState: 'applied',
      verificationState: 'verified',
      requestDigest: handoff.actionDigest,
      resultText: conflictingContent,
      recordedAt: 51,
    });

    const conflict = applyMobileControllerOutcomeInConversation(first.conversation, {
      runId: 'agent-run-mobile-1',
      handoff,
      receipt: conflictingReceipt,
      toolMessage: { ...settlement.toolMessage, content: conflictingContent },
      settledAt: 51,
    });

    expect(conflict).toEqual({ status: 'rejected', reason: 'tool_result_conflict' });
  });
});
