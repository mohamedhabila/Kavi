import {
  buildPendingAsyncOperationResumePrompt,
  clonePendingTrackedAsyncOperations,
} from '../../src/engine/pendingAsyncOperations';
import {
  createInitialAgentControlGraphSnapshot,
  reduceAgentControlGraph,
} from '../../src/engine/graph/agentControlGraph';
import {
  normalizeAgentRunAsyncOperations,
  areAgentRunAsyncOperationsEqual,
} from '../../src/services/agents/agentRunAsyncState';
import {
  buildAgentRunMobileControllerAsyncOperation,
  qualifyAgentRunMobileControllerHandoffRef,
} from '../../src/services/agents/mobileControllerAsyncOperation';
import { normalizePersistedAgentRun } from '../../src/store/agentRuns/shared';
import { sanitizeAgentRun } from '../../src/store/chatPersistenceAgentRuns';
import type {
  AgentRunAsyncOperation,
  AgentRunMobileControllerHandoffRef,
} from '../../src/types/agentRun';
import { makeTestAgentRun } from '../helpers/factories';

function handoffRef(
  overrides: Partial<AgentRunMobileControllerHandoffRef> = {},
): AgentRunMobileControllerHandoffRef {
  return {
    version: 1,
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
    ...overrides,
  };
}

function pendingOperation(): AgentRunAsyncOperation {
  const operation = buildAgentRunMobileControllerAsyncOperation({
    handoff: handoffRef(),
    updatedAt: 1_000,
  });
  if (!operation) throw new Error('expected valid mobile controller operation');
  return operation;
}

describe('agent-run mobile controller async state', () => {
  it('qualifies only exact content-free handoff references', () => {
    const handoff = handoffRef();
    expect(qualifyAgentRunMobileControllerHandoffRef(handoff)).toEqual(handoff);
    expect(
      qualifyAgentRunMobileControllerHandoffRef({ ...handoff, action: { kind: 'activate' } }),
    ).toBeNull();
    expect(
      qualifyAgentRunMobileControllerHandoffRef({
        ...handoff,
        capabilityDigest: `sha256:${'A'.repeat(64)}`,
      }),
    ).toBeNull();
    expect(
      qualifyAgentRunMobileControllerHandoffRef({ ...handoff, handoffId: 'latest' }),
    ).toBeNull();
  });

  it('normalizes one canonical blocking operation without monitor or wait tools', () => {
    const operation = pendingOperation();
    expect(normalizeAgentRunAsyncOperations([operation])).toEqual([operation]);
    expect(operation).toEqual({
      key: `mobile-controller-handoff:mch_${'a'.repeat(32)}`,
      kind: 'mobile-controller-handoff',
      resourceId: `mch_${'a'.repeat(32)}`,
      displayName: 'Mobile action',
      status: 'running',
      blocksFinalization: true,
      lastUpdatedByTool: 'mobile_ui_action',
      updatedAt: 1_000,
      monitorToolNames: [],
      mobileControllerHandoff: handoffRef(),
    });
  });

  it.each([
    ['mismatched resource', { resourceId: 'mch_mismatch' }],
    ['nonblocking', { blocksFinalization: false }],
    ['monitor tool', { monitorToolNames: ['mobile_ui_action'] }],
    ['wait tool', { waitToolName: 'mobile_ui_action' }],
    ['generic args', { statusArgs: { state: 'running' } }],
    ['terminal status', { status: 'completed' }],
  ])('drops a noncanonical mobile operation with %s', (_label, patch) => {
    expect(
      normalizeAgentRunAsyncOperations([
        { ...pendingOperation(), ...patch } as AgentRunAsyncOperation,
      ]),
    ).toBeUndefined();
  });

  it('moves an outstanding tool boundary into waiting_async without fabricating a result', () => {
    const graph = reduceAgentControlGraph(undefined, [
      { type: 'MODEL_TURN_STARTED', iteration: 1, timestamp: 900 },
      {
        type: 'MODEL_TURN_COMPLETED',
        iteration: 1,
        toolCalls: [{ id: 'tool-call-1', name: 'mobile_ui_action' }],
        timestamp: 950,
      },
      {
        type: 'ASYNC_WAITING',
        pendingAsyncCount: 1,
        pendingOperations: [pendingOperation()],
        timestamp: 1_000,
      },
    ]);

    expect(graph).toEqual(
      expect.objectContaining({
        status: 'waiting_async',
        expectedToolCalls: [{ id: 'tool-call-1', name: 'mobile_ui_action' }],
        observedToolResults: [],
        pendingAsyncCount: 1,
        asyncWork: expect.objectContaining({ pendingOperations: [pendingOperation()] }),
      }),
    );
  });

  it('restores a recovering graph to waiting_async from the same exact reference', () => {
    const recovering = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      { type: 'FINALIZATION_HELD', reason: 'external action pending', timestamp: 900 },
    ]);
    const restored = reduceAgentControlGraph(recovering, [
      {
        type: 'ASYNC_WAITING',
        pendingAsyncCount: 1,
        pendingOperations: [pendingOperation()],
        timestamp: 1_000,
      },
    ]);
    expect(restored.status).toBe('waiting_async');
    expect(restored.asyncWork.pendingOperations).toEqual([pendingOperation()]);
  });

  it('survives the production chat persistence and hydration boundaries exactly', () => {
    const graph = reduceAgentControlGraph(undefined, [
      {
        type: 'ASYNC_WAITING',
        pendingAsyncCount: 1,
        pendingOperations: [pendingOperation()],
        timestamp: 1_000,
      },
    ]);
    const run = makeTestAgentRun({ controlGraph: graph, updatedAt: 1_000 });
    const persisted = sanitizeAgentRun(run);
    const hydrated = normalizePersistedAgentRun(persisted);
    expect(hydrated.controlGraph?.status).toBe('waiting_async');
    expect(hydrated.controlGraph?.asyncWork.pendingOperations).toEqual([pendingOperation()]);
    expect(JSON.stringify(persisted.controlGraph?.asyncWork.pendingOperations)).not.toMatch(
      /claimToken|"action"|screenshot|"text"/u,
    );
  });

  it('clones identity without aliasing and gives no model monitor-tool instruction', () => {
    const operation = pendingOperation();
    const cloned = clonePendingTrackedAsyncOperations(new Map([[operation.key, operation]]));
    expect(cloned).toEqual([operation]);
    expect(cloned[0]).not.toBe(operation);
    expect(cloned[0].mobileControllerHandoff).not.toBe(operation.mobileControllerHandoff);
    expect(areAgentRunAsyncOperationsEqual(cloned, [operation])).toBe(true);

    const prompt = buildPendingAsyncOperationResumePrompt(cloned);
    expect(prompt).toContain('outcome=awaiting_controller_callback');
    expect(prompt).not.toMatch(/ssh_background_job|expo_eas|sessions_wait/u);
  });
});
