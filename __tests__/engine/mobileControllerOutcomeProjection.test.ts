import { reduceAgentControlGraph } from '../../src/engine/graph/agentControlGraph';
import { projectMobileControllerOutcomeToAgentRun } from '../../src/engine/graph/mobileControllerOutcomeProjection';
import { buildStructuredToolEffectReceipt } from '../../src/engine/toolExecution/toolEffectReceipt';
import { buildAgentRunMobileControllerAsyncOperation } from '../../src/services/agents/mobileControllerAsyncOperation';
import type { ToolMessageOutcome } from '../../src/engine/toolExecution/toolMessageOutcome';
import { createPersistedMobileControllerHandoffFixture } from '../helpers/mobileControllerHandoffFixture';
import { makeTestAgentRun } from '../helpers/factories';
import type { AgentRunMobileControllerRecoveryState } from '../../src/types/agentRun';

const persisted = createPersistedMobileControllerHandoffFixture();
const handoff = persisted.handoffRef;

function waitingGraph(recoveryState?: AgentRunMobileControllerRecoveryState) {
  const operation = buildAgentRunMobileControllerAsyncOperation({
    handoff,
    status: 'running',
    updatedAt: 40,
  });
  if (!operation) throw new Error('expected mobile controller async operation');
  const graph = reduceAgentControlGraph(undefined, [
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
  return recoveryState
    ? reduceAgentControlGraph(graph, [
        {
          type: 'TURN_DIRECTIVES_RECORDED',
          directives: { mobileControllerRecovery: recoveryState },
          reason: 'test recovery state',
          timestamp: 40,
        },
      ])
    : graph;
}

async function settlement(overrides: {
  effectState?: 'applied' | 'failed' | 'cancelled' | 'unknown';
  executionState?: 'completed' | 'failed' | 'timed_out' | 'cancelled' | 'unknown';
  status?: ToolMessageOutcome['status'];
  verificationState?: 'unverified' | 'acknowledged' | 'verified';
  observableDelta?: 'changed' | 'unchanged' | 'unknown';
} = {}) {
  const executionState = overrides.executionState ?? 'completed';
  const effectState = overrides.effectState ?? 'applied';
  const verificationState = overrides.verificationState ?? 'verified';
  const observableDelta = overrides.observableDelta ?? 'changed';
  const resultText = JSON.stringify({
    version: 1,
    executionState,
    effectState,
    verificationState,
    observableDelta,
  });
  const receipt = await buildStructuredToolEffectReceipt({
    toolCallId: handoff.toolCallId,
    toolName: 'mobile_ui_action',
    executionRunId: handoff.executionRunId,
    dispatchRunId: handoff.effectRunId,
    executionState,
    effectKind: 'unknown',
    effectState,
    verificationState,
    requestDigest: handoff.actionDigest,
    resultText,
    recordedAt: 50,
  });
  const toolMessage: ToolMessageOutcome = {
    version: 1,
    toolCallId: handoff.toolCallId,
    status: overrides.status ?? (effectState === 'applied' ? 'completed' : 'failed'),
    content: resultText,
  };
  return { receipt, toolMessage };
}

describe('mobile controller outcome graph projection', () => {
  it('records the deferred tool result and clears only its exact pending operation', async () => {
    const settled = await settlement();

    const result = projectMobileControllerOutcomeToAgentRun({
      run: makeTestAgentRun({ status: 'running', controlGraph: waitingGraph() }),
      handoff,
      ...settled,
      settledAt: 50,
    });

    expect(result.kind).toBe('projected');
    if (result.kind !== 'projected') throw new Error(result.reason);
    expect(result.controlGraph).toEqual(
      expect.objectContaining({
        status: 'ready',
        expectedToolCalls: [],
        observedToolResults: [],
        pendingAsyncCount: 0,
        updatedAt: 50,
      }),
    );
    expect(result.controlGraph.asyncWork.pendingOperations).toEqual([]);
    expect(result.controlGraph.audit.slice(-3).map((event) => event.type)).toEqual([
      'TOOL_RESULT_RECORDED',
      'TOOL_RESULT_RECORDED',
      'ASYNC_WAITING',
    ]);
  });

  it('accepts a canonical failed outcome while preserving failure truth', async () => {
    const settled = await settlement({
      executionState: 'failed',
      effectState: 'failed',
      verificationState: 'unverified',
      status: 'failed',
    });

    const result = projectMobileControllerOutcomeToAgentRun({
      run: makeTestAgentRun({ status: 'running', controlGraph: waitingGraph() }),
      handoff,
      ...settled,
      settledAt: 50,
    });

    expect(result.kind).toBe('projected');
  });

  it('advances content-free recovery state from the exact correlated outcome', async () => {
    const recoveryState: AgentRunMobileControllerRecoveryState = {
      version: 1,
      phase: 'action_in_flight',
      strategyFingerprint: `sha256:${'b'.repeat(64)}`,
      consecutiveStallCount: 1,
      toolCallId: handoff.toolCallId,
    };
    const settled = await settlement({ observableDelta: 'unchanged' });

    const result = projectMobileControllerOutcomeToAgentRun({
      run: makeTestAgentRun({ status: 'running', controlGraph: waitingGraph(recoveryState) }),
      handoff,
      ...settled,
      settledAt: 50,
    });

    expect(result.kind).toBe('projected');
    if (result.kind !== 'projected') throw new Error(result.reason);
    expect(result.controlGraph.turnDirectives.mobileControllerRecovery).toEqual({
      version: 1,
      phase: 'tracking',
      strategyFingerprint: recoveryState.strategyFingerprint,
      consecutiveStallCount: 2,
    });
  });

  it('clears recovery pressure only after correlated observable progress', async () => {
    const recoveryState: AgentRunMobileControllerRecoveryState = {
      version: 1,
      phase: 'recovery_in_flight',
      strategyFingerprint: `sha256:${'b'.repeat(64)}`,
      blockedStrategyFingerprint: `sha256:${'c'.repeat(64)}`,
      toolCallId: handoff.toolCallId,
    };
    const settled = await settlement({ observableDelta: 'changed' });

    const result = projectMobileControllerOutcomeToAgentRun({
      run: makeTestAgentRun({ status: 'running', controlGraph: waitingGraph(recoveryState) }),
      handoff,
      ...settled,
      settledAt: 50,
    });

    expect(result.kind).toBe('projected');
    if (result.kind !== 'projected') throw new Error(result.reason);
    expect(result.controlGraph.turnDirectives.mobileControllerRecovery).toBeUndefined();
  });

  it('rejects mismatched settlement identity without clearing pending work', async () => {
    const settled = await settlement();

    expect(
      projectMobileControllerOutcomeToAgentRun({
        run: makeTestAgentRun({ status: 'running', controlGraph: waitingGraph() }),
        handoff,
        ...settled,
        receipt: { ...settled.receipt, toolCallId: 'different-tool-call' },
        settledAt: 50,
      }),
    ).toEqual({ kind: 'rejected', reason: 'settlement_invalid' });
  });

  it('rejects terminal runs and a different pending controller operation', async () => {
    const settled = await settlement();
    expect(
      projectMobileControllerOutcomeToAgentRun({
        run: makeTestAgentRun({ status: 'completed', controlGraph: waitingGraph() }),
        handoff,
        ...settled,
        settledAt: 50,
      }),
    ).toEqual({ kind: 'rejected', reason: 'run_not_active' });

    const graph = waitingGraph();
    const differentOperation = {
      ...graph.asyncWork.pendingOperations[0]!,
      mobileControllerHandoff: {
        ...handoff,
        handoffId: `mch_${'f'.repeat(32)}`,
      },
    };
    const conflictingGraph = {
      ...graph,
      asyncWork: { ...graph.asyncWork, pendingOperations: [differentOperation] },
    };
    expect(
      projectMobileControllerOutcomeToAgentRun({
        run: makeTestAgentRun({ status: 'running', controlGraph: conflictingGraph }),
        handoff,
        ...settled,
        settledAt: 50,
      }),
    ).toEqual({ kind: 'rejected', reason: 'pending_operation_conflict' });
  });
});
