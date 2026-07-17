jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('expo-crypto', () => {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA256' },
    randomUUID: jest.fn(() => 'unused-random-uuid'),
    digestStringAsync: jest.fn(async (_algorithm: string, value: string) =>
      createHash('sha256').update(value, 'utf8').digest('hex'),
    ),
    digest: jest.fn(async (_algorithm: string, value: Uint8Array) =>
      Uint8Array.from(createHash('sha256').update(Buffer.from(value)).digest()).buffer,
    ),
  };
});

import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import type {
  DurablePlatformAdapterResult,
  DurablePlatformExecutionBridge,
  DurablePlatformExecutionPointer,
  IOSDurablePlatformRecord,
  IOSDurableWakeEvent,
} from '../../src/services/executionJournal/durablePlatformBridgeTypes';
import type { ExecutionExternalHandleInspectors } from '../../src/services/executionJournal/externalHandleReconciliation';
import { persistExternalToolObservation } from '../../src/services/executionJournal/externalToolObservationStore';
import { IOSDurableRecoveryLifecycle } from '../../src/services/executionJournal/iosDurableRecoveryLifecycle';
import {
  continuePersistedIOSExternalRecoveryRun,
  schedulePersistedIOSExternalRecoveryCandidateSlice,
  schedulePersistedIOSExternalRecoveryRun,
} from '../../src/services/executionJournal/iosDurableRecoveryScheduling';
import {
  coordinatePersistedExecutionRecovery,
  listPersistedExternalRecoveryCandidates,
  readPersistedExternalRecoveryCandidate,
} from '../../src/services/executionJournal/productionRecovery';
import { runIOSDurableWakeEvent } from '../../src/services/executionJournal/iosDurableWakeRunner';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests: () => void;
};

function pointer(record: IOSDurablePlatformRecord): DurablePlatformExecutionPointer {
  const identity = record.request.identity;
  return {
    schema: 1,
    runId: identity.runId,
    controlEpoch: identity.controlEpoch,
    snapshotUpdatedAtMillis: identity.snapshotUpdatedAtMillis,
    snapshotDigest: identity.snapshotDigest,
    commandDigest: identity.commandDigest,
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
  sqliteMock.__resetExpoSqliteForTests();
});

describe('iOS durable recovery restart integration', () => {
  it('replays a persisted native wake after JS restart and releases terminal evidence', async () => {
    const persisted = await persistExternalToolObservation({
      toolName: 'expo_eas_build',
      toolCallId: 'tool-call-build',
      argumentsText: '{"projectId":"project-1","platform":"ios"}',
      resultText: '{"mode":"eas-workflow","workflowRun":{"id":"workflow-run-1"}}',
      conversationId: 'conversation-1',
      parentAgentRunId: 'agent-run-1',
      handle: {
        version: 1,
        kind: 'expo_workflow_run',
        sourceToolName: 'expo_eas_build',
        projectId: 'project-1',
        workflowRunId: 'workflow-run-1',
        credentialRef: 'PROJECT_EXPO_TOKEN',
      },
      observedStatus: 'pending',
      observedAt: 1_000,
    });

    let nativeRecord: IOSDurablePlatformRecord | null = null;
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
        nativeRecord = record;
        return { schema: 1, status: 'accepted', reason: null, record };
      }),
      cancel: jest.fn(),
      complete: jest.fn(async (_attempt, receiptDigest, updatedAtMillis) => {
        if (nativeRecord === null) throw new Error('native-record-missing');
        const record: IOSDurablePlatformRecord = {
          ...nativeRecord,
          state: 'completed',
          receiptDigest,
          revision: nativeRecord.revision + 1,
          updatedAtMillis,
        };
        nativeRecord = record;
        return { schema: 1, status: 'accepted', reason: null, record };
      }),
      scheduleRetry: jest.fn(),
      block: jest.fn(),
      releaseTerminal: jest.fn(async (expected) => {
        if (
          nativeRecord === null ||
          JSON.stringify(pointer(nativeRecord)) !== JSON.stringify(expected)
        ) {
          return {
            schema: 1,
            status: 'rejected',
            reason: 'record_not_found',
            record: null,
          } as DurablePlatformAdapterResult;
        }
        const released = nativeRecord;
        nativeRecord = null;
        return { schema: 1, status: 'released', reason: null, record: released };
      }),
      getRecord: jest.fn(async () =>
        nativeRecord === null
          ? { schema: 1, status: 'missing', record: null }
          : { schema: 1, status: 'found', record: nativeRecord },
      ),
      reconcileOutboxes: jest.fn(),
    };
    const schedulingDependencies = {
      now: () => 1_001,
      readCandidate: readPersistedExternalRecoveryCandidate,
      listCandidates: listPersistedExternalRecoveryCandidates,
      getBridge: () => nativeBridge,
    };

    await expect(
      schedulePersistedIOSExternalRecoveryRun(persisted.runId, schedulingDependencies),
    ).resolves.toEqual({ kind: 'scheduled', runId: persisted.runId });
    if (nativeRecord === null) throw new Error('expected scheduled native record');
    const wakeRecord: IOSDurablePlatformRecord = {
      ...nativeRecord,
      state: 'running',
      attempt: 1,
      revision: 2,
      updatedAtMillis: 1_100,
    };
    nativeRecord = wakeRecord;
    const wake: IOSDurableWakeEvent = {
      schema: 1,
      trigger: 'relaunch_reconciliation',
      disposition: 'recover',
      record: wakeRecord,
    };
    nativeBridge.getPendingLaunches = jest.fn().mockResolvedValue({
      schema: 1,
      status: 'available',
      events: [wake],
    });

    // Drop every JS database owner while keeping the persisted SQLite file and native record.
    closeExecutionJournalDb();

    let identifier = 0;
    const inspectors: ExecutionExternalHandleInspectors = {
      readSecret: jest.fn(async () => 'resolved-token'),
      inspectExpoWorkflowRun: jest.fn(async () => ({
        id: 'workflow-run-1',
        status: 'SUCCESS',
      })),
      inspectGitHubWorkflowRun: jest.fn(async () => {
        throw new Error('unexpected-github-inspection');
      }),
    };
    const wakeOutcomes: unknown[] = [];
    const runEvent = async (event: IOSDurableWakeEvent) => {
      const outcome = await runIOSDurableWakeEvent(event, {
        now: () => 2_500,
        getBridge: () => nativeBridge,
        coordinate: (candidate) =>
          coordinatePersistedExecutionRecovery(candidate, {
            controlStore: {
              clock: () => 2_000,
              fenceLeaseMs: 1_000,
              createId: (kind) => `${kind}-${++identifier}`,
            },
            externalHandleReconciliation: { inspectors, retryAfterMs: 60_000 },
          }),
        continueRun: (runId, predecessor) =>
          continuePersistedIOSExternalRecoveryRun(runId, predecessor, schedulingDependencies),
        requestAttention: jest.fn(),
        abortOwner: jest.fn(),
      });
      wakeOutcomes.push(outcome);
      return outcome;
    };
    const lifecycle = new IOSDurableRecoveryLifecycle({
      platform: 'ios',
      getBridge: () => nativeBridge,
      subscribe: jest.fn(() => ({ remove: jest.fn() })),
      runEvent,
      scheduleSlice: (slice) =>
        schedulePersistedIOSExternalRecoveryCandidateSlice(slice, schedulingDependencies),
      yieldToRuntime: async () => undefined,
      warn: jest.fn(),
    });

    await lifecycle.reconcile('startup');

    expect(wakeOutcomes).toEqual([
      {
        kind: 'settled',
        runId: persisted.runId,
        settlement: 'completed',
        continuation: { kind: 'not_candidate', runId: persisted.runId },
      },
    ]);
    expect(nativeBridge.complete).toHaveBeenCalledTimes(1);
    expect(nativeBridge.releaseTerminal).toHaveBeenCalledTimes(1);
    expect(jest.mocked(nativeBridge.complete).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(nativeBridge.releaseTerminal).mock.invocationCallOrder[0],
    );
    expect(nativeRecord).toBeNull();
    expect(inspectors.inspectExpoWorkflowRun).toHaveBeenCalledWith(
      'resolved-token',
      'workflow-run-1',
    );
    expect(
      getExecutionJournalDb().getFirstSync<{ status: string; terminal_at: number }>(
        'SELECT status, terminal_at FROM execution_runs WHERE id = ?',
        persisted.runId,
      ),
    ).toEqual({ status: 'succeeded', terminal_at: 2_000 });
    expect(
      getExecutionJournalDb().getFirstSync<{ status: string }>(
        'SELECT status FROM execution_external_handles WHERE run_id = ?',
        persisted.runId,
      ),
    ).toEqual({ status: 'succeeded' });
    lifecycle.dispose();
  });
});
