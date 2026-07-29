import {
  planExecutionRecovery,
  type ExecutionRecoveryForegroundOwner,
} from '../../src/services/executionJournal/recoveryPlanner';
import type {
  ExecutionEffectRecord,
  ExecutionExternalHandleRecord,
  ExecutionExternalHandleStatus,
  ExecutionRunRecord,
} from '../../src/services/executionJournal/types';
import {
  recoveryCheckpoint,
  recoveryEffect,
  recoveryHandle,
  recoveryInitialCheckpoint,
  recoveryRun,
  recoverySnapshot,
} from '../helpers/executionRecoveryFixtures';

function mobileHandle(
  status: ExecutionExternalHandleStatus = 'pending',
  overrides: Partial<ExecutionExternalHandleRecord> = {},
): ExecutionExternalHandleRecord {
  return recoveryHandle(status, {
    locator: {
      version: 1,
      kind: 'mobile_controller_handoff',
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
  });
}

function waitingHistory(boundary: 'waiting_external' | 'safe_yield' = 'waiting_external') {
  return [
    recoveryInitialCheckpoint({ taskId: 'execution-run-1' }),
    recoveryCheckpoint({ boundary: 'before_effect', taskId: 'execution-run-1' }),
    recoveryCheckpoint({
      id: 'checkpoint-2',
      sequence: 2,
      boundary,
      taskId: 'execution-run-1',
      stateRefId: 'state-waiting',
      createdAt: 50,
    }),
  ];
}

function foregroundOwner(
  overrides: Partial<ExecutionRecoveryForegroundOwner> = {},
): ExecutionRecoveryForegroundOwner {
  return {
    executionRunId: 'execution-run-1',
    conversationId: 'conversation-1',
    agentRunId: 'agent-run-1',
    requestMessageId: 'message-1',
    status: 'waiting',
    controlEpoch: 0,
    updatedAt: 35,
    ...overrides,
  };
}

function mobileRecoverySnapshot(
  input: {
    run?: ExecutionRunRecord;
    foregroundOwner?: ExecutionRecoveryForegroundOwner | null;
    effects?: ExecutionEffectRecord[];
    handles?: ExecutionExternalHandleRecord[];
    checkpoints?: ReturnType<typeof waitingHistory>;
  } = {},
) {
  const handles = input.handles ?? [mobileHandle()];
  return recoverySnapshot({
    run: input.run ?? recoveryRun({ status: 'waiting', taskId: 'execution-run-1' }),
    ...(input.foregroundOwner === null
      ? {}
      : { foregroundOwner: input.foregroundOwner ?? foregroundOwner() }),
    checkpoints: input.checkpoints ?? waitingHistory(),
    effects: input.effects ?? [recoveryEffect('started')],
    handles,
  });
}

describe('mobile controller recovery planning', () => {
  it.each(['unknown', 'pending', 'running'] as const)(
    'restores one exact %s handoff at its committed action boundary',
    (status) => {
      const command = planExecutionRecovery(
        mobileRecoverySnapshot({ handles: [mobileHandle(status)] }),
      );

      expect(command).toEqual({
        kind: 'await_mobile_controller_handoff',
        runId: 'run-1',
        checkpointId: 'checkpoint-2',
        controlEpoch: 0,
        stateRefId: 'state-waiting',
        stateDigest: 'c'.repeat(64),
        conversationId: 'conversation-1',
        foregroundExecutionRunId: 'execution-run-1',
        foregroundControlEpoch: 0,
        foregroundUpdatedAt: 35,
        agentRunId: 'agent-run-1',
        requestMessageId: 'message-1',
        externalStatus: status,
        updatedAt: 40,
        handoff: {
          version: 1,
          effectRunId: 'run-1',
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
      });
      expect(JSON.stringify(command)).not.toMatch(/claimToken|"action"|screenshot|"text"/u);
    },
  );

  it.each([
    [
      'non-waiting effect run',
      mobileRecoverySnapshot({
        run: recoveryRun({ status: 'running', taskId: 'execution-run-1' }),
      }),
    ],
    ['missing graph owner', mobileRecoverySnapshot({ foregroundOwner: null })],
    [
      'cross-owned foreground run',
      mobileRecoverySnapshot({ foregroundOwner: foregroundOwner({ agentRunId: '' }) }),
    ],
    ['wrong boundary', mobileRecoverySnapshot({ checkpoints: waitingHistory('safe_yield') })],
    ['ambiguous effect', mobileRecoverySnapshot({ effects: [recoveryEffect('ambiguous')] })],
    [
      'stale epoch',
      mobileRecoverySnapshot({
        run: recoveryRun({
          status: 'waiting',
          taskId: 'execution-run-1',
          controlEpoch: 1,
        }),
      }),
    ],
  ])('fails closed for a %s', (_label, snapshot) => {
    expect(planExecutionRecovery(snapshot)).toEqual(
      expect.objectContaining({ kind: 'block', reason: 'snapshot_invalid' }),
    );
  });

  it('does not merge a mobile handoff with other unresolved work', () => {
    const secondEffect = recoveryEffect('started', {
      id: 'effect-2',
      toolCallId: 'tool-call-2',
      idempotencyKeyDigest: 'e'.repeat(64),
    });
    const secondHandle = recoveryHandle('pending', {
      id: 'handle-2',
      effectId: 'effect-2',
      createdAt: 41,
      updatedAt: 41,
      lastAttemptedAt: 41,
      lastVerifiedAt: 41,
    });
    expect(
      planExecutionRecovery(
        mobileRecoverySnapshot({
          effects: [recoveryEffect('started'), secondEffect],
          handles: [mobileHandle(), secondHandle],
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        kind: 'block',
        reason: 'snapshot_invalid',
        effectIds: ['effect-1', 'effect-2'],
        handleIds: ['handle-1', 'handle-2'],
      }),
    );
  });

  it('continues a verified tool result after its mobile handle becomes terminal', () => {
    expect(
      planExecutionRecovery(
        mobileRecoverySnapshot({
          effects: [recoveryEffect('verified')],
          handles: [mobileHandle('succeeded')],
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        kind: 'continue_after_tool_result',
        completedEffectIds: ['effect-1'],
      }),
    );
  });
});
