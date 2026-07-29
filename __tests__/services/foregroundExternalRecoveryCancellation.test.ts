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

import { closeExecutionJournalDb } from '../../src/services/executionJournal/database';
import { schedulePersistedAndroidExternalRecoveryRun } from '../../src/services/executionJournal/androidDurableRecoveryScheduling';
import { persistExternalToolObservation } from '../../src/services/executionJournal/externalToolObservationStore';
import {
  cancelOwnedExternalRecoveries,
  listOwnedExternalRecoveryRuns,
  type ForegroundExternalRecoveryCancellationDependencies,
} from '../../src/services/executionJournal/foregroundExternalRecoveryCancellation';
import { readPersistedExternalRecoveryCandidate } from '../../src/services/executionJournal/recoveryCandidates';
import { requestPersistedExecutionRecoveryCancellation } from '../../src/services/executionJournal/recoveryCancellation';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests: () => void;
};

function observation(workflowRunId: string, ownerRunId: string, observedAt: number) {
  return {
    toolName: 'expo_eas_build',
    toolCallId: `tool-call-${workflowRunId}`,
    argumentsText: JSON.stringify({ projectId: 'project-1', platform: 'ios' }),
    resultText: JSON.stringify({ workflowRun: { id: workflowRunId, status: 'NEW' } }),
    conversationId: 'conversation-1',
    parentAgentRunId: ownerRunId,
    handle: {
      version: 1 as const,
      kind: 'expo_workflow_run' as const,
      sourceToolName: 'expo_eas_build',
      projectId: 'project-1',
      workflowRunId,
      credentialRef: 'PROJECT_EXPO_TOKEN',
    },
    observedStatus: 'pending' as const,
    observedAt,
  };
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

describe('foreground-owned external recovery cancellation', () => {
  it('cancels every exact owned generation and leaves other foreground runs schedulable', async () => {
    const first = await persistExternalToolObservation(observation('workflow-1', 'agent-1', 100));
    const second = await persistExternalToolObservation(observation('workflow-2', 'agent-1', 200));
    const other = await persistExternalToolObservation(observation('workflow-3', 'agent-2', 300));

    const result = await cancelOwnedExternalRecoveries(
      {
        conversationId: 'conversation-1',
        ownerRunId: 'agent-1',
        reason: 'Stopped by the user.',
      },
      {
        listOwned: listOwnedExternalRecoveryRuns,
        query: async ({ runId }) => {
          const candidate = await readPersistedExternalRecoveryCandidate(runId);
          if (candidate.kind !== 'candidate') {
            return {
              kind: 'query_blocked' as const,
              runId,
              generation: null,
              reason: 'run_unavailable' as const,
            };
          }
          return {
            kind: 'recovery_plan' as const,
            runId,
            generation: candidate.candidate.generation,
            command: candidate.candidate.command,
          };
        },
        cancel: async (input) => {
          const journal = await requestPersistedExecutionRecoveryCancellation(input);
          return journal.kind === 'requested'
            ? {
                ...journal,
                native: {
                  kind: 'not_supported' as const,
                  runId: input.runId,
                  reason: 'unsupported_platform' as const,
                },
              }
            : journal;
        },
        now: () => 1_000,
        yieldToRuntime: () => Promise.resolve(),
      },
    );

    expect(result).toEqual({ cancelledRunCount: 2, settledRunCount: 0, issues: [] });
    await expect(readPersistedExternalRecoveryCandidate(first.runId)).resolves.toEqual({
      kind: 'not_candidate',
      runId: first.runId,
    });
    await expect(readPersistedExternalRecoveryCandidate(second.runId)).resolves.toEqual({
      kind: 'not_candidate',
      runId: second.runId,
    });
    await expect(readPersistedExternalRecoveryCandidate(other.runId)).resolves.toMatchObject({
      kind: 'candidate',
      candidate: { runId: other.runId },
    });
    expect(
      listOwnedExternalRecoveryRuns({
        conversationId: 'conversation-1',
        ownerRunId: 'agent-1',
        limit: 25,
      }),
    ).toEqual({ kind: 'runs', runIds: [], nextAfter: null });

    const enqueueNative = jest.fn();
    await expect(
      schedulePersistedAndroidExternalRecoveryRun(first.runId, {
        now: () => 1_001,
        readCandidate: readPersistedExternalRecoveryCandidate,
        listCandidates: jest.fn(),
        readNative: jest.fn(),
        releaseNative: jest.fn(),
        enqueueNative,
      }),
    ).resolves.toEqual({ kind: 'not_candidate', runId: first.runId });
    expect(enqueueNative).not.toHaveBeenCalled();
  });

  it('replans a raced generation before cancellation and logs native deferral once', async () => {
    const generationOne = {
      controlEpoch: 0,
      updatedAt: 10,
      snapshotDigest: 'a'.repeat(64),
    };
    const generationTwo = {
      controlEpoch: 0,
      updatedAt: 11,
      snapshotDigest: 'b'.repeat(64),
    };
    let active = true;
    const listOwned = jest.fn(() => ({
      kind: 'runs' as const,
      runIds: active ? ['external-1'] : [],
      nextAfter: null,
    }));
    const query = jest
      .fn<ReturnType<ForegroundExternalRecoveryCancellationDependencies['query']>, []>()
      .mockResolvedValueOnce({
        kind: 'recovery_plan',
        runId: 'external-1',
        generation: generationOne,
        command: {
          kind: 'reconcile_external_handles',
          runId: 'external-1',
          controlEpoch: 0,
          effectIds: ['effect-1'],
          handleIds: ['handle-1'],
        },
      })
      .mockResolvedValue({
        kind: 'recovery_plan',
        runId: 'external-1',
        generation: generationTwo,
        command: {
          kind: 'reconcile_external_handles',
          runId: 'external-1',
          controlEpoch: 0,
          effectIds: ['effect-1'],
          handleIds: ['handle-1'],
        },
      });
    const cancel = jest
      .fn<ReturnType<ForegroundExternalRecoveryCancellationDependencies['cancel']>, []>()
      .mockResolvedValueOnce({ kind: 'rejected', reason: 'generation_changed' })
      .mockImplementation(async (input) => {
        active = false;
        return {
          kind: 'requested',
          receipt: {
            runId: input.runId,
            controlEpoch: 0,
            cancellationState: 'cancel_requested',
            updatedAt: input.occurredAt,
          },
          native: {
            kind: 'deferred',
            runId: input.runId,
            reason: 'native_bridge_unavailable',
          },
        };
      });

    await expect(
      cancelOwnedExternalRecoveries(
        {
          conversationId: 'conversation-1',
          ownerRunId: 'agent-1',
          reason: 'Stopped by the user.',
        },
        {
          listOwned,
          query: query as ForegroundExternalRecoveryCancellationDependencies['query'],
          cancel: cancel as ForegroundExternalRecoveryCancellationDependencies['cancel'],
          now: () => 20,
          yieldToRuntime: () => Promise.resolve(),
        },
      ),
    ).resolves.toEqual({
      cancelledRunCount: 0,
      settledRunCount: 0,
      issues: [{ kind: 'deferred', reason: 'native_bridge_unavailable', count: 1 }],
    });
    expect(cancel).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ expectedGeneration: generationTwo, occurredAt: 20 }),
    );
    expect(listOwned).toHaveBeenCalledTimes(2);
  });

  it.each([
    { conversationId: ' conversation-1', ownerRunId: 'agent-1', limit: 1 },
    { conversationId: 'conversation-1', ownerRunId: 'agent-1', limit: 0 },
    { conversationId: 'conversation-1', ownerRunId: 'agent-1', limit: 101 },
    { conversationId: 'conversation-1', ownerRunId: 'agent-1', limit: 1, after: '' },
  ])('rejects malformed bounded lookup input %#', (input) => {
    expect(listOwnedExternalRecoveryRuns(input)).toEqual({
      kind: 'blocked',
      reason: 'invalid_request',
    });
  });
});
