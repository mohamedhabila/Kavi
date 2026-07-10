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

import { resolveExternalToolResultDurability } from '../../src/engine/durability/externalToolResult';
import { scheduleAndroidDurableRecoveryRepair } from '../../src/services/executionJournal/androidDurableRecoveryLifecycle';
import { schedulePersistedAndroidExternalRecoveryCandidateSlice } from '../../src/services/executionJournal/androidDurableRecoveryScheduling';
import { closeExecutionJournalDb } from '../../src/services/executionJournal/database';
import { observeExternalToolResultDurability } from '../../src/services/executionJournal/externalToolDurabilityLifecycle';
import { persistExternalToolObservation } from '../../src/services/executionJournal/externalToolObservationStore';
import {
  listPersistedExternalRecoveryCandidates,
  readPersistedExternalRecoveryCandidate,
} from '../../src/services/executionJournal/recoveryCandidates';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests: () => void;
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

describe('production external tool recovery lifecycle', () => {
  it('turns a real Expo result into a startup-scheduled exact Android generation', async () => {
    const rawResult = JSON.stringify({
      mode: 'eas-workflow',
      jobId: 'remote-job-1',
      workflowRun: {
        id: 'd7f109d3-2c6b-45ed-99e8-b94f120901ab',
        url: 'https://expo.dev/accounts/openai/projects/kavi/workflows/d7f109d3',
        status: 'NEW',
        conclusion: null,
      },
      guidance: 'Use expo_eas_workflow_status for an exact snapshot.',
    });
    const input = {
      toolName: 'expo_eas_build',
      toolCallId: 'tool-call-build-1',
      argumentsText: JSON.stringify({ projectId: 'local-project', platform: 'android' }),
      resultText: rawResult,
      conversationId: 'conversation-1',
      parentAgentRunId: 'agent-run-1',
      observedAt: 1_000,
    };

    const observed = await observeExternalToolResultDurability(input, {
      resolve: (candidate) =>
        resolveExternalToolResultDurability(candidate, {
          resolveExpoProjectContext: () => ({
            project: {
              id: 'local-project',
              easProjectId: 'eas-project-id',
              name: 'Kavi Mobile',
              accountId: 'expo-account',
              owner: 'openai',
              slug: 'kavi',
              enabled: true,
              mode: 'eas-workflow',
            },
            account: {
              id: 'expo-account',
              name: 'Expo',
              owner: 'openai',
              tokenRef: 'PROJECT_EXPO_TOKEN',
              enabled: true,
            },
          }),
        }),
      persist: persistExternalToolObservation,
      schedule: async (runId) => ({ kind: 'not_android', runId }),
    });
    expect(observed).toMatchObject({
      kind: 'persisted',
      observation: { kind: 'created', status: 'pending', terminal: false },
      scheduling: { kind: 'not_android' },
    });
    if (observed.kind !== 'persisted') throw new Error('expected persisted observation');

    const enqueueNative = jest.fn(async () => ({ status: 'accepted' as const }));
    const schedulerDependencies = {
      now: () => 1_001,
      readCandidate: readPersistedExternalRecoveryCandidate,
      listCandidates: listPersistedExternalRecoveryCandidates,
      readNative: async () => ({
        schema: 1 as const,
        status: 'missing' as const,
        record: null,
        reason: 'not_found' as const,
      }),
      releaseNative: jest.fn(),
      enqueueNative,
    };
    const scheduleSlice = jest.fn((input) =>
      schedulePersistedAndroidExternalRecoveryCandidateSlice(input, schedulerDependencies),
    );

    scheduleAndroidDurableRecoveryRepair('startup', {
      platform: 'android',
      scheduleSlice,
      continueAfterYield: (continuation) => setTimeout(continuation, 0),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(scheduleSlice).toHaveBeenCalledTimes(1);
    expect(enqueueNative).toHaveBeenCalledTimes(1);
    expect(enqueueNative).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: 1,
        durabilityClass: 'external_durable_operation',
        identity: expect.objectContaining({
          runId: observed.observation.runId,
          commandKind: 'reconcile_external_handles',
          commandDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
          snapshotDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
        constraints: expect.objectContaining({ network: 'connected' }),
      }),
    );
  });
});
