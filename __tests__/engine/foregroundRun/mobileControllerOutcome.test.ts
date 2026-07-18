import { reduceAgentControlGraph } from '../../../src/engine/graph/agentControlGraph';
import { prepareForegroundMobileControllerOutcome } from '../../../src/engine/graph/foregroundRun/mobileControllerOutcome';
import { buildAgentRunMobileControllerAsyncOperation } from '../../../src/services/agents/mobileControllerAsyncOperation';
import type { ChatState } from '../../../src/store/chatStoreTypes';
import { applyMobileControllerOutcomeInConversation } from '../../../src/store/agentRuns/mobileControllerOutcome';
import {
  createMobileControllerCapabilityFixture,
  createMobileControllerOutcomeFixture,
  createMobileControllerSettlementFixture,
  createPersistedMobileControllerHandoffFixture,
} from '../../helpers/mobileControllerHandoffFixture';
import { makeTestAgentRun, makeTestConversation, makeTestMessage } from '../../helpers/factories';

const persisted = createPersistedMobileControllerHandoffFixture();
const handoff = persisted.handoffRef;
const outcome = createMobileControllerOutcomeFixture();

function waitingConversation() {
  const operation = buildAgentRunMobileControllerAsyncOperation({
    handoff,
    status: 'running',
    updatedAt: 40,
  });
  if (!operation) throw new Error('expected mobile controller async operation');
  const controlGraph = reduceAgentControlGraph(undefined, [
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
            arguments: '{}',
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
        controlGraph,
      }),
    ],
  });
}

function controllerForAfterObservation() {
  if (!outcome.afterObservation) throw new Error('expected after-observation fixture');
  return {
    capability: createMobileControllerCapabilityFixture(),
    currentObservation: outcome.afterObservation,
    publishHandoff: jest.fn(),
  };
}

describe('foreground mobile controller outcome preparation', () => {
  it('settles, atomically projects, and flushes before allowing the same run to continue', async () => {
    const settled = await createMobileControllerSettlementFixture();
    const events: string[] = [];
    let current = waitingConversation();
    const applyOutcome: ChatState['applyMobileControllerOutcome'] = (conversationId, input) => {
      events.push('project');
      const result = applyMobileControllerOutcomeInConversation(current, input);
      if (conversationId === current.id && result.status === 'applied') {
        current = result.conversation;
      }
      return result;
    };

    const result = await prepareForegroundMobileControllerOutcome({
      conversation: current,
      conversationId: current.id,
      options: {
        reuseAgentRunId: 'agent-run-mobile-1',
        mobileController: controllerForAfterObservation(),
        mobileControllerOutcome: { handoff, outcome },
      },
      applyOutcome,
      flushChatState: async () => {
        events.push('flush');
      },
      getConversation: () => current,
      settleOutcome: async () => {
        events.push('settle');
        return settled;
      },
    });

    expect(result).toEqual({ kind: 'applied', conversation: current });
    expect(events).toEqual(['settle', 'project', 'flush']);
    expect(current.agentRuns?.[0]?.id).toBe('agent-run-mobile-1');
    expect(current.agentRuns?.[0]?.controlGraph?.status).toBe('ready');
  });

  it('accepts an exact callback replay after the pending graph state has been cleared', async () => {
    const settled = await createMobileControllerSettlementFixture('replayed');
    const first = applyMobileControllerOutcomeInConversation(waitingConversation(), {
      runId: 'agent-run-mobile-1',
      handoff,
      receipt: settled.receipt,
      toolMessage: settled.toolMessage,
      settledAt: settled.settledAt,
    });
    if (first.status !== 'applied') throw new Error(first.reason);
    const completedConversation = {
      ...first.conversation,
      agentRuns: first.conversation.agentRuns?.map((run) => ({
        ...run,
        status: 'completed' as const,
        controlGraph: run.controlGraph
          ? { ...run.controlGraph, status: 'finalized' as const }
          : undefined,
      })),
    };
    const events: string[] = [];

    const result = await prepareForegroundMobileControllerOutcome({
      conversation: completedConversation,
      conversationId: completedConversation.id,
      options: {
        reuseAgentRunId: 'agent-run-mobile-1',
        mobileControllerOutcome: { handoff, outcome },
      },
      applyOutcome: (conversationId, input) => {
        events.push('project');
        return applyMobileControllerOutcomeInConversation(completedConversation, input);
      },
      flushChatState: async () => {
        events.push('flush');
      },
      getConversation: () => completedConversation,
      settleOutcome: async () => {
        events.push('settle');
        return settled;
      },
    });

    expect(result).toEqual({ kind: 'replayed' });
    expect(events).toEqual(['settle', 'project']);
  });

  it('rejects a mismatched latest observation before settling external state', async () => {
    const settleOutcome = jest.fn(async () => createMobileControllerSettlementFixture());
    const result = await prepareForegroundMobileControllerOutcome({
      conversation: waitingConversation(),
      conversationId: 'conversation-mobile-1',
      options: {
        reuseAgentRunId: 'agent-run-mobile-1',
        mobileController: {
          ...controllerForAfterObservation(),
          currentObservation: {
            observationId: 'different-observation',
            digest: `sha256:${'8'.repeat(64)}`,
          },
        },
        mobileControllerOutcome: { handoff, outcome },
      },
      applyOutcome: jest.fn(),
      flushChatState: jest.fn(),
      getConversation: jest.fn(),
      settleOutcome,
    });

    expect(result).toEqual({ kind: 'rejected', reason: 'observation_mismatch' });
    expect(settleOutcome).not.toHaveBeenCalled();
  });
});
