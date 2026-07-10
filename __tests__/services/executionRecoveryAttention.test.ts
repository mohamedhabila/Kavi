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
import { persistExternalToolObservation } from '../../src/services/executionJournal/externalToolObservationStore';
import { requestExecutionRecoveryAttention } from '../../src/services/executionJournal/recoveryAttention';
import { readPersistedExternalRecoveryCandidate } from '../../src/services/executionJournal/recoveryCandidates';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests: () => void;
};

const pendingInput = {
  toolName: 'expo_eas_build',
  toolCallId: 'tool-call-build',
  argumentsText: JSON.stringify({ projectId: 'project-1', platform: 'ios' }),
  resultText: JSON.stringify({
    mode: 'eas-workflow',
    workflowRun: { id: 'workflow-run-1', status: 'NEW' },
  }),
  conversationId: 'conversation-1',
  parentAgentRunId: 'agent-run-1',
  handle: {
    version: 1 as const,
    kind: 'expo_workflow_run' as const,
    sourceToolName: 'expo_eas_build',
    projectId: 'project-1',
    workflowRunId: 'workflow-run-1',
    credentialRef: 'PROJECT_EXPO_TOKEN',
  },
  observedStatus: 'pending' as const,
  observedAt: 100,
};

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

describe('execution recovery attention', () => {
  it('persists attention and blocks the exact journal generation atomically', async () => {
    const persisted = await persistExternalToolObservation(pendingInput);
    const candidate = await readPersistedExternalRecoveryCandidate(persisted.runId);
    if (candidate.kind !== 'candidate') throw new Error('expected candidate');
    const occurredAt = candidate.candidate.generation.updatedAt + 1;

    await expect(
      requestExecutionRecoveryAttention({
        runId: persisted.runId,
        expectedGeneration: candidate.candidate.generation,
        reason: 'continued_processing_expired',
        occurredAt,
      }),
    ).resolves.toEqual({
      kind: 'recorded',
      receipt: {
        runId: persisted.runId,
        controlEpoch: candidate.candidate.generation.controlEpoch,
        sourceGenerationUpdatedAt: candidate.candidate.generation.updatedAt,
        reason: 'continued_processing_expired',
        recordedAt: occurredAt,
      },
    });
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT r.status, r.updated_at, a.reason, a.source_generation_updated_at
         FROM execution_runs r
         JOIN execution_recovery_attention a ON a.run_id = r.id
         WHERE r.id = ?`,
        persisted.runId,
      ),
    ).toEqual({
      status: 'blocked',
      updated_at: occurredAt,
      reason: 'continued_processing_expired',
      source_generation_updated_at: candidate.candidate.generation.updatedAt,
    });
    await expect(readPersistedExternalRecoveryCandidate(persisted.runId)).resolves.toEqual({
      kind: 'not_candidate',
      runId: persisted.runId,
    });
  });

  it('rejects stale or malformed attention without mutating the journal', async () => {
    const persisted = await persistExternalToolObservation(pendingInput);
    const candidate = await readPersistedExternalRecoveryCandidate(persisted.runId);
    if (candidate.kind !== 'candidate') throw new Error('expected candidate');

    await expect(
      requestExecutionRecoveryAttention({
        runId: persisted.runId,
        expectedGeneration: {
          ...candidate.candidate.generation,
          updatedAt: candidate.candidate.generation.updatedAt - 1,
        },
        reason: 'recovery_blocked',
        occurredAt: candidate.candidate.generation.updatedAt + 1,
      }),
    ).resolves.toEqual({ kind: 'rejected', reason: 'generation_changed' });
    await expect(
      requestExecutionRecoveryAttention({
        runId: persisted.runId,
        expectedGeneration: candidate.candidate.generation,
        reason: 'future_reason',
        occurredAt: candidate.candidate.generation.updatedAt + 1,
      } as never),
    ).resolves.toEqual({ kind: 'rejected', reason: 'invalid_request' });
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM execution_recovery_attention',
      )?.count,
    ).toBe(0);
  });
});
