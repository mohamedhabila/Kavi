jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('expo-crypto', () => {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA256' },
    digestStringAsync: jest.fn(async (_algorithm: string, value: string) =>
      createHash('sha256').update(value, 'utf8').digest('hex'),
    ),
    digest: jest.fn(
      async (_algorithm: string, value: Uint8Array) =>
        Uint8Array.from(createHash('sha256').update(Buffer.from(value)).digest()).buffer,
    ),
  };
});

import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import {
  appendExecutionCheckpoint,
  createExecutionRun,
  planExecutionEffect,
  registerExecutionExternalHandle,
  transitionExecutionEffect,
  transitionExecutionRun,
} from '../../src/services/executionJournal/mutations';
import {
  listPersistedExternalRecoveryCandidates,
  readPersistedExternalRecoveryCandidate,
} from '../../src/services/executionJournal/recoveryCandidates';
import { queryExecutionRecovery } from '../../src/services/executionJournal/recoveryQuery';
import {
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  DIGEST_D,
  executionCheckpointRecord,
  executionRunRecord,
} from '../helpers/executionJournalMutationFixtures';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests: () => void;
};

function resetJournal(): void {
  try {
    closeExecutionJournalDb();
  } catch {}
  sqliteMock.__resetExpoSqliteForTests();
}

function persistWaitingMobileHandoff(): void {
  const foregroundRun = executionRunRecord({
    id: 'execution-run-1',
    taskId: 'agent-run-1',
    requestMessageId: 'message-1',
    durabilityClass: 'foreground_interactive',
    requestedCapability: 'compute',
    executionSurface: 'model',
    resumeStrategy: 'not_resumable',
    nextRetryPolicy: 'none',
    createdAt: 1,
    updatedAt: 1,
  });
  createExecutionRun({
    run: foregroundRun,
    initialCheckpoint: executionCheckpointRecord(foregroundRun, {
      id: 'foreground-checkpoint-0',
      stateRefId: 'foreground-assistant-message',
    }),
  });
  transitionExecutionRun({
    runId: foregroundRun.id,
    expectedStatus: 'queued',
    nextStatus: 'running',
    expectedControlEpoch: 0,
    nextControlEpoch: 0,
    occurredAt: 2,
  });
  transitionExecutionRun({
    runId: foregroundRun.id,
    expectedStatus: 'running',
    nextStatus: 'waiting',
    expectedControlEpoch: 0,
    nextControlEpoch: 0,
    occurredAt: 3,
  });

  const run = executionRunRecord({
    taskId: foregroundRun.id,
    requestMessageId: 'tool-call-1',
    resumeStrategy: 'reconcile_first',
    nextRetryPolicy: 'reconcile_before_retry',
  });
  createExecutionRun({ run, initialCheckpoint: executionCheckpointRecord(run) });
  transitionExecutionRun({
    runId: run.id,
    expectedStatus: 'queued',
    nextStatus: 'running',
    expectedControlEpoch: 0,
    nextControlEpoch: 0,
    occurredAt: 11,
  });
  appendExecutionCheckpoint({
    id: 'checkpoint-plan',
    runId: run.id,
    expectedControlEpoch: 0,
    taskId: run.taskId,
    goalId: run.goalId,
    phase: 'work',
    boundary: 'before_effect',
    stateRefId: 'state-plan',
    stateDigest: DIGEST_C,
    resumeStrategy: 'reconcile_first',
    approvalState: 'not_required',
    permissionState: 'granted',
    createdAt: 12,
  });
  planExecutionEffect({
    id: 'effect-1',
    runId: run.id,
    checkpointId: 'checkpoint-plan',
    expectedControlEpoch: 0,
    toolCallId: 'tool-call-1',
    toolNameDigest: DIGEST_A,
    effectClass: 'external_run',
    idempotencyClass: 'declared_idempotent',
    idempotencyKeyDigest: DIGEST_D,
    requestDigest: DIGEST_B,
    retryPolicy: 'reconcile_before_retry',
    attempt: 1,
    createdAt: 13,
  });
  appendExecutionCheckpoint({
    id: 'checkpoint-authority',
    runId: run.id,
    expectedControlEpoch: 0,
    taskId: run.taskId,
    goalId: run.goalId,
    phase: 'work',
    boundary: 'before_effect',
    stateRefId: 'state-authority',
    stateDigest: DIGEST_C,
    resumeStrategy: 'reconcile_first',
    approvalState: 'not_required',
    permissionState: 'granted',
    createdAt: 14,
  });
  transitionExecutionEffect({
    runId: run.id,
    effectId: 'effect-1',
    expectedStatus: 'planned',
    nextStatus: 'started',
    expectedControlEpoch: 0,
    executionAuthorityCheckpointId: 'checkpoint-authority',
    occurredAt: 14,
  });
  registerExecutionExternalHandle({
    id: 'handle-1',
    monitorId: 'monitor-1',
    runId: run.id,
    effectId: 'effect-1',
    expectedControlEpoch: 0,
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
    sourceToolNameDigest: DIGEST_A,
    status: 'pending',
    createdAt: 15,
  });
  appendExecutionCheckpoint({
    id: 'checkpoint-waiting',
    runId: run.id,
    expectedControlEpoch: 0,
    taskId: run.taskId,
    goalId: run.goalId,
    phase: 'work',
    boundary: 'waiting_external',
    stateRefId: 'state-waiting',
    stateDigest: DIGEST_C,
    resumeStrategy: 'reconcile_first',
    approvalState: 'not_required',
    permissionState: 'granted',
    createdAt: 16,
  });
  transitionExecutionRun({
    runId: run.id,
    expectedStatus: 'running',
    nextStatus: 'waiting',
    expectedControlEpoch: 0,
    nextControlEpoch: 0,
    occurredAt: 17,
  });
}

beforeEach(resetJournal);
afterEach(resetJournal);

describe('persisted mobile controller recovery', () => {
  it('round-trips the same content-free recovery command across a database reopen', async () => {
    persistWaitingMobileHandoff();

    const first = await queryExecutionRecovery({ runId: 'run-1' });
    expect(first).toEqual(
      expect.objectContaining({
        kind: 'recovery_plan',
        runId: 'run-1',
        generation: expect.objectContaining({ controlEpoch: 0, updatedAt: 17 }),
        command: expect.objectContaining({
          kind: 'await_mobile_controller_handoff',
          conversationId: 'conversation-1',
          foregroundExecutionRunId: 'execution-run-1',
          foregroundControlEpoch: 0,
          foregroundUpdatedAt: 3,
          agentRunId: 'agent-run-1',
          requestMessageId: 'message-1',
          externalStatus: 'pending',
          updatedAt: 15,
          handoff: expect.objectContaining({
            effectRunId: 'run-1',
            executionRunId: 'execution-run-1',
            effectId: 'effect-1',
            externalHandleId: 'handle-1',
            toolCallId: 'tool-call-1',
          }),
        }),
      }),
    );
    expect(JSON.stringify(first)).not.toMatch(/claimToken|"action"|screenshot|"text"/u);

    closeExecutionJournalDb();
    const reopened = await queryExecutionRecovery({ runId: 'run-1' });
    expect(reopened).toEqual(first);
  });

  it('fails closed when the foreground execution owner crosses conversations', async () => {
    persistWaitingMobileHandoff();
    getExecutionJournalDb().runSync(
      `UPDATE execution_runs SET conversation_id = 'other-conversation'
       WHERE id = 'execution-run-1'`,
    );

    await expect(queryExecutionRecovery({ runId: 'run-1' })).resolves.toEqual({
      kind: 'query_blocked',
      runId: 'run-1',
      generation: null,
      reason: 'mixed_ownership',
    });
  });

  it('never sends a foreground mobile handoff to cloud workflow scheduling', async () => {
    persistWaitingMobileHandoff();

    await expect(readPersistedExternalRecoveryCandidate('run-1')).resolves.toEqual({
      kind: 'not_candidate',
      runId: 'run-1',
    });
    await expect(listPersistedExternalRecoveryCandidates({ limit: 10 })).resolves.toEqual({
      kind: 'candidates',
      candidates: [],
      nextAfter: null,
    });
  });
});
