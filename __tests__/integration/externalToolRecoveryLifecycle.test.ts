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

import { resolveExternalToolResultDurability } from '../../src/engine/durability/externalToolResult';
import { scheduleAndroidDurableRecoveryRepair } from '../../src/services/executionJournal/androidDurableRecoveryLifecycle';
import { schedulePersistedAndroidExternalRecoveryCandidateSlice } from '../../src/services/executionJournal/androidDurableRecoveryScheduling';
import { closeExecutionJournalDb } from '../../src/services/executionJournal/database';
import { scheduleDurableRecoveryRunImmediately } from '../../src/services/executionJournal/durableRecoveryLifecycle';
import type {
  DurablePlatformExecutionBridge,
  IOSDurablePlatformRecord,
} from '../../src/services/executionJournal/durablePlatformBridgeTypes';
import { observeExternalToolResultDurability } from '../../src/services/executionJournal/externalToolDurabilityLifecycle';
import { persistExternalToolObservation } from '../../src/services/executionJournal/externalToolObservationStore';
import { schedulePersistedIOSExternalRecoveryRun } from '../../src/services/executionJournal/iosDurableRecoveryScheduling';
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
  it('turns a real Expo result into an immediate exact iOS generation', async () => {
    const input = {
      toolName: 'expo_eas_build',
      toolCallId: 'tool-call-build-ios',
      argumentsText: JSON.stringify({ projectId: 'local-project', platform: 'ios' }),
      resultText: JSON.stringify({
        mode: 'eas-workflow',
        workflowRun: {
          id: 'd7f109d3-2c6b-45ed-99e8-b94f120901ab',
          status: 'NEW',
          conclusion: null,
        },
      }),
      conversationId: 'conversation-1',
      parentAgentRunId: 'agent-run-1',
      observedAt: 1_000,
    };
    let scheduledRecord: IOSDurablePlatformRecord | undefined;
    const nativeBridge: DurablePlatformExecutionBridge = {
      bridgeSchema: 1,
      wakeEventName: 'KaviDurableExecutionWake',
      supportsProgressCheckpoint: false,
      enqueue: jest.fn(async (request) => {
        const record: IOSDurablePlatformRecord = {
          request,
          schedulerKind: 'background_processing',
          taskIdentifier: 'com.kavi.app.durable-processing',
          state: 'submitted',
          attempt: 0,
          nextAttemptAtMillis: null,
          failureReason: null,
          receiptDigest: null,
          progressCompleted: null,
          progressTotal: null,
          lastCheckpointAtMillis: null,
          revision: 1,
          updatedAtMillis: 1_001,
        };
        scheduledRecord = record;
        return { schema: 1, status: 'accepted', reason: null, record };
      }),
      cancel: jest.fn(),
      complete: jest.fn(),
      scheduleRetry: jest.fn(),
      block: jest.fn(),
      releaseTerminal: jest.fn(),
      getRecord: jest.fn().mockResolvedValue({ schema: 1, status: 'missing', record: null }),
      reconcileOutboxes: jest.fn(),
    };
    const scheduleIOS = (runId: string) =>
      schedulePersistedIOSExternalRecoveryRun(runId, {
        now: () => 1_001,
        readCandidate: readPersistedExternalRecoveryCandidate,
        listCandidates: listPersistedExternalRecoveryCandidates,
        getBridge: () => nativeBridge,
      });

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
      schedule: (runId) =>
        scheduleDurableRecoveryRunImmediately(runId, {
          platform: 'ios',
          scheduleAndroid: jest.fn(),
          scheduleIOS,
          repairAndroid: jest.fn(),
          initializeIOS: jest.fn(),
          reconcileIOS: jest.fn(),
        }),
    });

    expect(observed).toMatchObject({
      kind: 'persisted',
      observation: { kind: 'created', status: 'pending', terminal: false },
      scheduling: { kind: 'scheduled' },
    });
    expect(scheduledRecord).toEqual(
      expect.objectContaining({
        state: 'submitted',
        request: expect.objectContaining({
          durabilityClass: 'external_durable_operation',
          identity: expect.objectContaining({
            runId: expect.stringMatching(/^external-/u),
            commandKind: 'reconcile_external_handles',
            commandDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
            snapshotDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
          }),
          constraints: expect.objectContaining({ network: 'connected' }),
        }),
      }),
    );
  });

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
      schedule: async (runId) => ({
        kind: 'not_supported',
        runId,
        reason: 'unsupported_platform',
      }),
    });
    expect(observed).toMatchObject({
      kind: 'persisted',
      observation: { kind: 'created', status: 'pending', terminal: false },
      scheduling: { kind: 'not_supported', reason: 'unsupported_platform' },
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
