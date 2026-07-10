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
  __resetAgentRunCancellationRegistryForTests,
  createAgentRunOperationController,
} from '../../src/services/agents/agentRunCancellation';
import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import { persistExternalToolObservation } from '../../src/services/executionJournal/externalToolObservationStore';
import { requestPersistedExecutionRecoveryCancellation } from '../../src/services/executionJournal/recoveryCancellation';
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
  __resetAgentRunCancellationRegistryForTests();
});

afterEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
  __resetAgentRunCancellationRegistryForTests();
});

describe('persisted execution recovery cancellation', () => {
  it('journals cancellation before aborting the exact JS owner', async () => {
    const persisted = await persistExternalToolObservation(pendingInput);
    const candidate = await readPersistedExternalRecoveryCandidate(persisted.runId);
    if (candidate.kind !== 'candidate') throw new Error('expected candidate');
    const owner = createAgentRunOperationController({
      conversationId: 'conversation-1',
      runId: 'agent-run-1',
      operationId: 'remote-monitor',
    });
    const observedState: string[] = [];
    owner.signal.addEventListener('abort', () => {
      observedState.push(
        getExecutionJournalDb().getFirstSync<{ cancellation_state: string }>(
          'SELECT cancellation_state FROM execution_recovery_controls WHERE run_id = ?',
          persisted.runId,
        )?.cancellation_state ?? 'missing',
      );
    });

    await expect(
      requestPersistedExecutionRecoveryCancellation({
        runId: persisted.runId,
        expectedGeneration: candidate.candidate.generation,
        occurredAt: candidate.candidate.generation.updatedAt + 1,
        reason: 'User cancelled the durable run.',
      }),
    ).resolves.toEqual({
      kind: 'requested',
      receipt: {
        runId: persisted.runId,
        controlEpoch: 0,
        cancellationState: 'cancel_requested',
        updatedAt: candidate.candidate.generation.updatedAt + 1,
      },
    });
    expect(owner.signal.aborted).toBe(true);
    expect(observedState).toEqual(['cancel_requested']);
    await expect(readPersistedExternalRecoveryCandidate(persisted.runId)).resolves.toEqual({
      kind: 'not_candidate',
      runId: persisted.runId,
    });
    owner.dispose();
  });

  it('does not abort an owner when the expected generation is stale', async () => {
    const persisted = await persistExternalToolObservation(pendingInput);
    const candidate = await readPersistedExternalRecoveryCandidate(persisted.runId);
    if (candidate.kind !== 'candidate') throw new Error('expected candidate');
    const abortOwner = jest.fn();

    await expect(
      requestPersistedExecutionRecoveryCancellation(
        {
          runId: persisted.runId,
          expectedGeneration: {
            ...candidate.candidate.generation,
            updatedAt: candidate.candidate.generation.updatedAt - 1,
          },
          occurredAt: candidate.candidate.generation.updatedAt + 1,
        },
        { abortOwner },
      ),
    ).resolves.toEqual({ kind: 'rejected', reason: 'generation_changed' });
    expect(abortOwner).not.toHaveBeenCalled();
    expect(
      getExecutionJournalDb().getFirstSync<{ cancellation_state: string }>(
        'SELECT cancellation_state FROM execution_recovery_controls WHERE run_id = ?',
        persisted.runId,
      ),
    ).toEqual({ cancellation_state: 'active' });
  });
});
