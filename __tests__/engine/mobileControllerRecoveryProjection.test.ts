import {
  buildAgentRunMobileControllerAsyncOperation,
} from '../../src/services/agents/mobileControllerAsyncOperation';
import type { MobileControllerRecoveryCommand } from '../../src/services/executionJournal/mobileControllerRecoveryCommand';
import {
  projectMobileControllerRecoveryToAgentRun,
} from '../../src/engine/graph/mobileControllerRecoveryProjection';
import {
  reduceAgentControlGraph,
} from '../../src/engine/graph/agentControlGraph';
import type { AgentRunControlGraphState } from '../../src/types/agentRun';
import { makeTestAgentRun } from '../helpers/factories';

function command(
  overrides: Partial<MobileControllerRecoveryCommand> = {},
): MobileControllerRecoveryCommand {
  return {
    kind: 'await_mobile_controller_handoff',
    runId: 'effect-run-1',
    checkpointId: 'checkpoint-2',
    controlEpoch: 0,
    stateRefId: 'state-waiting',
    stateDigest: 'd'.repeat(64),
    conversationId: 'conversation-1',
    foregroundExecutionRunId: 'execution-run-1',
    foregroundControlEpoch: 0,
    foregroundUpdatedAt: 35,
    agentRunId: 'agent-run-1',
    requestMessageId: 'message-1',
    externalStatus: 'pending',
    updatedAt: 40,
    handoff: {
      version: 1,
      effectRunId: 'effect-run-1',
      executionRunId: 'execution-run-1',
      effectId: 'effect-1',
      externalHandleId: 'handle-1',
      toolCallId: 'tool-call-1',
      controlEpoch: 0,
      handoffId: `mch_${'a'.repeat(32)}`,
      controllerId: 'mobile-controller-1',
      controllerContractVersion: 1,
      capabilityDigest: `sha256:${'a'.repeat(64)}`,
      actionDigest: `sha256:${'b'.repeat(64)}`,
      beforeObservationId: 'observation-1',
      beforeObservationDigest: `sha256:${'c'.repeat(64)}`,
      expiresAt: 60_000,
    },
    ...overrides,
  };
}

function awaitingGraph(): AgentRunControlGraphState {
  return reduceAgentControlGraph(undefined, [
    { type: 'MODEL_TURN_STARTED', iteration: 1, timestamp: 20 },
    {
      type: 'MODEL_TURN_COMPLETED',
      iteration: 1,
      toolCalls: [{ id: 'tool-call-1', name: 'mobile_ui_action' }],
      timestamp: 30,
    },
  ]);
}

function project(
  recoveryCommand = command(),
  controlGraph: AgentRunControlGraphState | undefined = awaitingGraph(),
  runOverrides: Parameters<typeof makeTestAgentRun>[0] = {},
) {
  return projectMobileControllerRecoveryToAgentRun({
    conversationId: 'conversation-1',
    run: makeTestAgentRun({
      id: 'agent-run-1',
      userMessageId: 'message-1',
      status: 'running',
      controlGraph,
      ...runOverrides,
    }),
    command: recoveryCommand,
  });
}

describe('mobile controller recovery graph projection', () => {
  it('restores the exact pending tool boundary without fabricating a result', () => {
    const result = project();
    expect(result.kind).toBe('projected');
    if (result.kind !== 'projected') throw new Error('expected projected result');

    expect(result.controlGraph).toEqual(
      expect.objectContaining({
        status: 'waiting_async',
        expectedToolCalls: [{ id: 'tool-call-1', name: 'mobile_ui_action' }],
        observedToolResults: [],
        pendingAsyncCount: 1,
        updatedAt: 40,
      }),
    );
    expect(result.controlGraph.asyncWork.pendingOperations).toEqual([
      expect.objectContaining({
        kind: 'mobile-controller-handoff',
        status: 'running',
        blocksFinalization: true,
        updatedAt: 40,
        mobileControllerHandoff: command().handoff,
      }),
    ]);

    const replay = project(command(), result.controlGraph);
    expect(replay).toEqual({ kind: 'projected', controlGraph: result.controlGraph });
    if (replay.kind === 'projected') expect(replay.controlGraph).toBe(result.controlGraph);
  });

  it('keeps graph time monotonic when the journal observation is older', () => {
    const graph = reduceAgentControlGraph(undefined, [
      { type: 'MODEL_TURN_STARTED', iteration: 1, timestamp: 90 },
      {
        type: 'MODEL_TURN_COMPLETED',
        iteration: 1,
        toolCalls: [{ id: 'tool-call-1', name: 'mobile_ui_action' }],
        timestamp: 100,
      },
    ]);
    const result = project(command({ updatedAt: 40 }), graph);
    expect(result).toEqual(
      expect.objectContaining({
        kind: 'projected',
        controlGraph: expect.objectContaining({ updatedAt: 100 }),
      }),
    );
    if (result.kind === 'projected') {
      expect(result.controlGraph.asyncWork.pendingOperations[0]?.updatedAt).toBe(40);
    }
  });

  it.each([
    ['conversation', { conversationId: 'other-conversation' }],
    ['agent run', { agentRunId: 'other-run' }],
    ['request message', { requestMessageId: 'other-message' }],
  ])('rejects a mismatched %s owner', (_label, overrides) => {
    expect(project(command(overrides))).toEqual({ kind: 'rejected', reason: 'owner_mismatch' });
  });

  it('rejects a missing, terminal, or unrelated graph boundary', () => {
    expect(project(command(), undefined, { controlGraph: undefined })).toEqual({
      kind: 'rejected',
      reason: 'graph_state_invalid',
    });
    expect(project(command(), awaitingGraph(), { status: 'completed' })).toEqual({
      kind: 'rejected',
      reason: 'run_not_active',
    });
    expect(
      project(
        command(),
        reduceAgentControlGraph(undefined, [
          { type: 'MODEL_TURN_STARTED', iteration: 1, timestamp: 20 },
          { type: 'MODEL_TURN_COMPLETED', iteration: 1, timestamp: 30 },
        ]),
      ),
    ).toEqual({ kind: 'rejected', reason: 'graph_state_invalid' });
  });

  it('does not overwrite another pending operation or a cancellation request', () => {
    const otherCommand = command({
      handoff: {
        ...command().handoff,
        handoffId: `mch_${'b'.repeat(32)}`,
        actionDigest: `sha256:${'e'.repeat(64)}`,
      },
    });
    const otherOperation = buildAgentRunMobileControllerAsyncOperation({
      handoff: otherCommand.handoff,
      updatedAt: 35,
    });
    const cancellation = buildAgentRunMobileControllerAsyncOperation({
      handoff: command().handoff,
      status: 'cancel_requested',
      updatedAt: 35,
    });
    if (!otherOperation || !cancellation) throw new Error('expected valid operations');

    for (const operation of [otherOperation, cancellation]) {
      const graph = reduceAgentControlGraph(awaitingGraph(), [
        {
          type: 'ASYNC_WAITING',
          pendingAsyncCount: 1,
          pendingOperations: [operation],
          timestamp: 35,
        },
      ]);
      expect(project(command(), graph)).toEqual({
        kind: 'rejected',
        reason: 'pending_operation_conflict',
      });
    }
  });

  it('does not infer missing async identity from an inconsistent waiting graph', () => {
    const inconsistent = {
      ...awaitingGraph(),
      status: 'waiting_async' as const,
    };
    expect(project(command(), inconsistent)).toEqual({
      kind: 'rejected',
      reason: 'pending_operation_conflict',
    });
  });

  it('rejects malformed command extensions at the runtime boundary', () => {
    const malformed = {
      ...command(),
      handoff: { ...command().handoff, action: { kind: 'tap', coordinates: [1, 2] } },
    } as unknown as MobileControllerRecoveryCommand;
    expect(project(malformed)).toEqual({ kind: 'rejected', reason: 'command_invalid' });
  });
});
