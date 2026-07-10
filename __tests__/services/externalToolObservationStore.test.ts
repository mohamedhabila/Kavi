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
import { readPersistedExternalRecoveryCandidate } from '../../src/services/executionJournal/recoveryCandidates';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests: () => void;
};

const pendingInput = {
  toolName: 'expo_eas_build',
  toolCallId: 'tool-call-build',
  argumentsText: JSON.stringify({ projectId: 'project-1', platform: 'android' }),
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

describe('external tool observation journal', () => {
  it('atomically creates one recoverable external-operation run', async () => {
    const persisted = await persistExternalToolObservation(pendingInput);
    expect(persisted).toMatchObject({
      kind: 'created',
      status: 'pending',
      terminal: false,
    });

    const database = getExecutionJournalDb();
    expect(
      database.getFirstSync<{ status: string; durability_class: string }>(
        'SELECT status, durability_class FROM execution_runs WHERE id = ?',
        persisted.runId,
      ),
    ).toEqual({ status: 'waiting', durability_class: 'external_durable_operation' });
    expect(
      database.getFirstSync<{ status: string; credential_ref: string }>(
        'SELECT status, credential_ref FROM execution_external_handles WHERE run_id = ?',
        persisted.runId,
      ),
    ).toEqual({ status: 'pending', credential_ref: 'PROJECT_EXPO_TOKEN' });

    await expect(readPersistedExternalRecoveryCandidate(persisted.runId)).resolves.toMatchObject({
      kind: 'candidate',
      candidate: {
        runId: persisted.runId,
        command: {
          kind: 'reconcile_external_handles',
          effectIds: [persisted.runId.replace('external-', 'external-effect-')],
          handleIds: [persisted.runId.replace('external-', 'external-handle-')],
        },
      },
    });
  });

  it('deduplicates repeated pending observations by exact remote locator', async () => {
    const first = await persistExternalToolObservation(pendingInput);
    const second = await persistExternalToolObservation({
      ...pendingInput,
      observedAt: 101,
    });

    expect(second).toEqual({
      kind: 'unchanged',
      runId: first.runId,
      handleId: first.handleId,
      status: 'pending',
      terminal: false,
    });
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM execution_runs',
      )?.count,
    ).toBe(1);
  });

  it('advances an exact monitor observation and closes a terminal success', async () => {
    const first = await persistExternalToolObservation(pendingInput);
    const terminal = await persistExternalToolObservation({
      ...pendingInput,
      toolName: 'expo_eas_workflow_wait',
      toolCallId: 'tool-call-wait',
      argumentsText: JSON.stringify({ projectId: 'project-1', workflowRunId: 'workflow-run-1' }),
      resultText: JSON.stringify({
        status: 'ok',
        mode: 'eas-workflow',
        workflowRun: { id: 'workflow-run-1', status: 'SUCCESS' },
      }),
      handle: {
        ...pendingInput.handle,
        sourceToolName: 'expo_eas_workflow_wait',
      },
      observedStatus: 'succeeded',
      observedAt: 110,
    });

    expect(terminal).toEqual({
      kind: 'advanced',
      runId: first.runId,
      handleId: first.handleId,
      status: 'succeeded',
      terminal: true,
    });
    const database = getExecutionJournalDb();
    expect(
      database.getFirstSync<{ status: string; terminal_at: number }>(
        'SELECT status, terminal_at FROM execution_runs WHERE id = ?',
        first.runId,
      ),
    ).toEqual({ status: 'succeeded', terminal_at: 110 });
    expect(
      database.getFirstSync<{ status: string }>(
        'SELECT status FROM execution_effects WHERE run_id = ?',
        first.runId,
      ),
    ).toEqual({ status: 'verified' });
    expect(
      database.getFirstSync<{ boundary: string }>(
        `SELECT boundary FROM execution_checkpoints
         WHERE run_id = ? ORDER BY sequence DESC LIMIT 1`,
        first.runId,
      ),
    ).toEqual({ boundary: 'terminal' });
    await expect(readPersistedExternalRecoveryCandidate(first.runId)).resolves.toEqual({
      kind: 'not_candidate',
      runId: first.runId,
    });
  });

  it.each([
    ['failed', 'failed'],
    ['cancelled', 'cancelled'],
  ] as const)('closes a terminal %s observation', async (observedStatus, runStatus) => {
    const first = await persistExternalToolObservation(pendingInput);
    const terminal = await persistExternalToolObservation({
      ...pendingInput,
      resultText: JSON.stringify({ status: observedStatus }),
      observedStatus,
      observedAt: 120,
    });
    expect(terminal.terminal).toBe(true);
    expect(
      getExecutionJournalDb().getFirstSync<{ status: string }>(
        'SELECT status FROM execution_runs WHERE id = ?',
        first.runId,
      ),
    ).toEqual({ status: runStatus });
  });

  it('rolls back the whole projection when an exact identity conflicts', async () => {
    const first = await persistExternalToolObservation(pendingInput);
    getExecutionJournalDb().runSync(
      `UPDATE execution_external_handles SET workflow_run_id = 'corrupted-run' WHERE run_id = ?`,
      first.runId,
    );
    await expect(
      persistExternalToolObservation({
        ...pendingInput,
        observedStatus: 'running',
        observedAt: 130,
      }),
    ).rejects.toThrow('execution_journal_external_observation_identity_conflict');
    expect(
      getExecutionJournalDb().getFirstSync<{ status: string }>(
        'SELECT status FROM execution_external_handles WHERE run_id = ?',
        first.runId,
      ),
    ).toEqual({ status: 'pending' });
  });
});
