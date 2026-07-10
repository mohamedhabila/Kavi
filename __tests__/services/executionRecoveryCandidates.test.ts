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
} from '../../src/services/executionJournal/productionRecovery';
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

function seedCandidate(suffix: string, createdAt: number): void {
  const runId = `run-${suffix}`;
  const taskId = `task-${suffix}`;
  const goalId = `goal-${suffix}`;
  const run = executionRunRecord({
    id: runId,
    conversationId: `conversation-${suffix}`,
    threadId: `thread-${suffix}`,
    taskId,
    goalId,
    requestMessageId: `message-${suffix}`,
    createdAt,
    updatedAt: createdAt,
  });
  createExecutionRun({
    run,
    initialCheckpoint: executionCheckpointRecord(run, {
      id: `checkpoint-${suffix}-0`,
      stateRefId: `state-${suffix}-0`,
    }),
  });
  transitionExecutionRun({
    runId,
    expectedStatus: 'queued',
    nextStatus: 'running',
    expectedControlEpoch: 0,
    nextControlEpoch: 0,
    occurredAt: createdAt + 1,
  });
  appendExecutionCheckpoint({
    id: `checkpoint-${suffix}-plan`,
    runId,
    expectedControlEpoch: 0,
    taskId,
    goalId,
    phase: 'work',
    boundary: 'before_effect',
    stateRefId: `state-${suffix}-plan`,
    stateDigest: DIGEST_C,
    resumeStrategy: 'replay_safe',
    approvalState: 'not_required',
    permissionState: 'granted',
    createdAt: createdAt + 2,
  });
  planExecutionEffect({
    id: `effect-${suffix}`,
    runId,
    checkpointId: `checkpoint-${suffix}-plan`,
    expectedControlEpoch: 0,
    toolCallId: `tool-call-${suffix}`,
    toolNameDigest: DIGEST_A,
    effectClass: 'external_run',
    idempotencyClass: 'declared_idempotent',
    idempotencyKeyDigest: DIGEST_D,
    requestDigest: DIGEST_B,
    retryPolicy: 'reconcile_before_retry',
    attempt: 1,
    createdAt: createdAt + 3,
  });
  appendExecutionCheckpoint({
    id: `checkpoint-${suffix}-authority`,
    runId,
    expectedControlEpoch: 0,
    taskId,
    goalId,
    phase: 'work',
    boundary: 'before_effect',
    stateRefId: `state-${suffix}-authority`,
    stateDigest: DIGEST_C,
    resumeStrategy: 'replay_safe',
    approvalState: 'not_required',
    permissionState: 'granted',
    createdAt: createdAt + 4,
  });
  transitionExecutionEffect({
    runId,
    effectId: `effect-${suffix}`,
    expectedStatus: 'planned',
    nextStatus: 'started',
    expectedControlEpoch: 0,
    executionAuthorityCheckpointId: `checkpoint-${suffix}-authority`,
    occurredAt: createdAt + 4,
  });
  registerExecutionExternalHandle({
    id: `handle-${suffix}`,
    runId,
    effectId: `effect-${suffix}`,
    expectedControlEpoch: 0,
    locator: {
      version: 1,
      kind: 'expo_workflow_run',
      projectId: `project-${suffix}`,
      workflowRunId: `workflow-${suffix}`,
      credentialRef: 'EXPO_TOKEN',
    },
    sourceToolNameDigest: DIGEST_A,
    status: 'pending',
    createdAt: createdAt + 5,
  });
}

beforeEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
  sqliteMock.__resetExpoSqliteForTests();
});

afterEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
});

describe('persisted external recovery candidate scan', () => {
  it('returns bounded deterministic pages with exact generation and command identity', async () => {
    seedCandidate('a', 10);
    seedCandidate('b', 20);

    const first = await listPersistedExternalRecoveryCandidates({ limit: 1 });
    expect(first).toEqual({
      kind: 'candidates',
      candidates: [
        expect.objectContaining({
          runId: 'run-a',
          generation: expect.objectContaining({ updatedAt: 15 }),
          command: expect.objectContaining({
            kind: 'reconcile_external_handles',
            effectIds: ['effect-a'],
            handleIds: ['handle-a'],
          }),
          commandDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
          retryAt: null,
        }),
      ],
      nextAfter: '[15,"run-a"]',
    });
    if (first.kind !== 'candidates' || !first.nextAfter) throw new Error('expected next page');

    const second = await listPersistedExternalRecoveryCandidates({
      limit: 1,
      after: first.nextAfter,
    });
    expect(second).toEqual({
      kind: 'candidates',
      candidates: [expect.objectContaining({ runId: 'run-b' })],
      nextAfter: null,
    });
  });

  it('omits terminal handles and non-reconciliation plans', async () => {
    seedCandidate('a', 10);
    getExecutionJournalDb().runSync(
      `UPDATE execution_external_handles
       SET status = 'succeeded', updated_at = 16,
           last_attempted_at = 16, last_verified_at = 16
       WHERE id = 'handle-a'`,
    );
    getExecutionJournalDb().runSync(`UPDATE execution_runs SET updated_at = 16 WHERE id = 'run-a'`);
    getExecutionJournalDb().runSync(
      `UPDATE execution_effects
       SET status = 'verified', outcome_digest = ?, completed_at = 16, updated_at = 16
       WHERE id = 'effect-a'`,
      DIGEST_C,
    );

    await expect(listPersistedExternalRecoveryCandidates({ limit: 10 })).resolves.toEqual({
      kind: 'candidates',
      candidates: [],
      nextAfter: null,
    });
    await expect(readPersistedExternalRecoveryCandidate('run-a')).resolves.toEqual({
      kind: 'not_candidate',
      runId: 'run-a',
    });
  });

  it.each([
    { limit: 0 },
    { limit: 101 },
    { limit: 1, after: 'not-a-cursor' },
    { limit: 1, after: '[10," run-a"]' },
    { limit: 1, unexpected: true },
  ])('fails closed for malformed pagination input %#', async (input) => {
    await expect(listPersistedExternalRecoveryCandidates(input as never)).resolves.toEqual({
      kind: 'blocked',
      reason: 'invalid_request',
    });
  });

  it('fails exact-candidate lookup closed for malformed run identity', async () => {
    await expect(readPersistedExternalRecoveryCandidate(' run-a')).resolves.toEqual({
      kind: 'blocked',
      reason: 'invalid_request',
    });
  });

  it('fails the scan closed when a selected journal graph is malformed', async () => {
    seedCandidate('a', 10);
    const database = getExecutionJournalDb();
    database.execSync('PRAGMA ignore_check_constraints = ON');
    database.runSync(
      `UPDATE execution_external_handles SET workflow_run_id = 'latest' WHERE id = 'handle-a'`,
    );
    database.execSync('PRAGMA ignore_check_constraints = OFF');

    await expect(listPersistedExternalRecoveryCandidates({ limit: 10 })).resolves.toEqual({
      kind: 'blocked',
      reason: 'journal_unavailable',
    });
  });
});
