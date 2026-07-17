jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../../src/services/memory/verifiedProcedure/calendarPreconditions', () => ({
  resolveCalendarVerifiedProcedurePreconditions: jest.fn().mockResolvedValue({
    satisfied: true,
    reason: 'satisfied',
    platform: 'ios',
    preconditionIds: [
      'app.tool.calendar_create_event.allowed',
      'app.tool.calendar_list.allowed',
      'os.calendar.permission.granted',
      'platform.ios',
    ],
  }),
  resolveCalendarUpdateVerifiedProcedurePreconditions: jest.fn().mockResolvedValue({
    satisfied: true,
    reason: 'satisfied',
    platform: 'ios',
    preconditionIds: [
      'app.tool.calendar_events.allowed',
      'app.tool.calendar_update_event.allowed',
      'os.calendar.permission.granted',
      'platform.ios',
    ],
  }),
}));

import * as Crypto from 'expo-crypto';
import { createInitialAgentControlGraphSnapshot } from '../../../src/engine/graph/agentControlGraph';
import { buildModelTurnMemoryPolicyBinding } from '../../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { buildToolEffectReceipt } from '../../../src/engine/toolExecution/toolEffectReceipt';
import { runMemoryTransaction } from '../../../src/services/memory/access/transaction';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import {
  advanceVerifiedProcedureProjectionInTransaction,
  captureVerifiedProcedureAuthoritySnapshot,
} from '../../../src/services/memory/verifiedProcedure/observationAuthority';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import {
  commitPendingVerifiedProcedureObservation,
  createVerifiedProcedureExecutionSession,
  type PendingVerifiedProcedureObservation,
  type VerifiedProcedureExecutionSession,
} from '../../../src/services/memory/verifiedProcedure/executionSession';
import { invalidateVerifiedProcedureObservationsForExecutionRun } from '../../../src/services/memory/verifiedProcedure/invalidation';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { buildAssistantMessageMetadata } from '../../../src/utils/assistantMessageMetadata';
import {
  buildCurrentModelTurnMemoryPolicyBinding,
  captureCurrentModelTurnMemoryFence,
} from '../../helpers/modelTurnMemoryAuthority';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const OBSERVED_AT = 30_000_000_000;

function advanceProjectionOnly(): void {
  const db = getMemoryDb();
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  runMemoryTransaction(() => {
    advanceVerifiedProcedureProjectionInTransaction(db, memoryOwnerId);
  });
}

async function createSession(runId: string): Promise<VerifiedProcedureExecutionSession> {
  const session = await createVerifiedProcedureExecutionSession({
    executionRunId: runId,
    memoryConversationId: `memory-${runId}`,
    sourceThreadId: `thread-${runId}`,
  });
  if (!session) throw new Error('verified_procedure_session_unavailable');
  return session;
}

async function observeList(
  session: VerifiedProcedureExecutionSession,
  runId: string,
  memoryPolicyBinding = buildCurrentModelTurnMemoryPolicyBinding(),
): Promise<void> {
  const outcome = await listOutcome(runId);
  await planList(session, runId, memoryPolicyBinding);
  await session.observeRawOutcome(outcome);
}

async function planList(
  session: VerifiedProcedureExecutionSession,
  runId: string,
  memoryPolicyBinding = buildCurrentModelTurnMemoryPolicyBinding(),
): Promise<void> {
  await session.observePlannedBatch({
    iteration: 1,
    executeInParallel: false,
    memoryPolicyBinding,
    toolCalls: [{ batchIndex: 0, toolCallId: `${runId}-list`, toolName: 'calendar_list' }],
  });
}

async function listOutcome(runId: string) {
  const resultText = JSON.stringify([
    { id: 'calendar-origin-authority', allowsModifications: true },
  ]);
  return {
    iteration: 1,
    batchIndex: 0,
    toolCallId: `${runId}-list`,
    toolName: 'calendar_list',
    argumentsText: '{}',
    resultText,
    receipt: await buildToolEffectReceipt({
      toolCallId: `${runId}-list`,
      toolName: 'calendar_list',
      argumentsText: '{}',
      resultText,
      transportState: 'returned',
      executionRunId: runId,
      recordedAt: OBSERVED_AT,
    }),
  } as const;
}

async function observeCreate(
  session: VerifiedProcedureExecutionSession,
  runId: string,
  memoryPolicyBinding = buildCurrentModelTurnMemoryPolicyBinding(),
): Promise<void> {
  const argumentsText = JSON.stringify({
    title: 'Origin authority event',
    startDate: '2026-08-01T10:00:00.000Z',
    endDate: '2026-08-01T11:00:00.000Z',
    calendarId: 'calendar-origin-authority',
  });
  const resultText = JSON.stringify({
    status: 'created_verified',
    eventId: `event-${runId}`,
    calendarId: 'calendar-origin-authority',
  });
  await session.observePlannedBatch({
    iteration: 2,
    executeInParallel: false,
    memoryPolicyBinding,
    toolCalls: [
      {
        batchIndex: 0,
        toolCallId: `${runId}-create`,
        toolName: 'calendar_create_event',
      },
    ],
  });
  await session.observeRawOutcome({
    iteration: 2,
    batchIndex: 0,
    toolCallId: `${runId}-create`,
    toolName: 'calendar_create_event',
    argumentsText,
    resultText,
    receipt: await buildToolEffectReceipt({
      toolCallId: `${runId}-create`,
      toolName: 'calendar_create_event',
      argumentsText,
      resultText,
      transportState: 'returned',
      executionRunId: runId,
      recordedAt: OBSERVED_AT + 1,
    }),
  });
}

async function seal(
  session: VerifiedProcedureExecutionSession,
): Promise<PendingVerifiedProcedureObservation | null> {
  return session.sealGraphCandidate({
    graphSnapshot: createInitialAgentControlGraphSnapshot({
      status: 'awaiting_review',
      iteration: 3,
      pendingAsyncCount: 0,
      asyncWork: { awaitingBackgroundWorkers: false, pendingOperations: [], updatedAt: 3 },
    }),
    finalAssistant: {
      content: 'The calendar operation is complete.',
      metadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'complete',
        finishReason: 'stop',
      }),
    },
  });
}

function memoryLineage(runId: string) {
  return {
    sourceMessageId: `message-${runId}`,
    sourceRunId: `agent-${runId}`,
    sourceTurnId: `turn-${runId}`,
    taskId: null,
  } as const;
}

function buildCurrentProcedureAwareBinding() {
  const db = getMemoryDb();
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  const verifiedProcedureAuthoritySnapshot = captureVerifiedProcedureAuthoritySnapshot(
    db,
    memoryOwnerId,
  );
  if (!verifiedProcedureAuthoritySnapshot) throw new Error('procedure_authority_unavailable');
  return buildModelTurnMemoryPolicyBinding({
    ...captureCurrentModelTurnMemoryFence(),
    verifiedProcedureAuthoritySnapshot,
  });
}

function deferNextCryptoDigest() {
  const digest = jest.mocked(Crypto.digest);
  const original = digest.getMockImplementation();
  if (!original) throw new Error('crypto_digest_mock_unavailable');
  let release = () => undefined;
  let announce = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    announce = resolve;
  });
  digest.mockImplementationOnce(async (...args) => {
    announce();
    await gate;
    return original(...args);
  });
  return { release, started };
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
});

afterEach(() => {
  closeMemoryDb();
  jest.restoreAllMocks();
});

describe('verified procedure originating memory authority', () => {
  it('keeps admitted evidence valid across projection-only additions', async () => {
    const runId = 'procedure-projection-update';
    const session = await createSession(runId);
    await expect(session.buildApplicableAdvisory([])).resolves.toBeNull();
    await observeList(session, runId);

    advanceProjectionOnly();

    await observeCreate(session, runId);
    const pending = await seal(session);
    expect(pending).not.toBeNull();
    await expect(
      commitPendingVerifiedProcedureObservation({
        memoryLineage: memoryLineage(runId),
        pending: pending!,
        surface: 'foreground',
        terminalObservedAt: OBSERVED_AT + 2,
      }),
    ).resolves.toMatchObject({ status: 'recorded' });
  });

  it('rejects targeted invalidation after planning but before raw evidence', async () => {
    const runId = 'procedure-invalidated-after-plan';
    const session = await createSession(runId);
    const outcome = await listOutcome(runId);
    await planList(session, runId);

    expect(invalidateVerifiedProcedureObservationsForExecutionRun(runId)).toEqual({
      status: 'invalidated',
      deletedCount: 0,
    });
    await session.observeRawOutcome(outcome);

    await expect(seal(session)).resolves.toBeNull();
  });

  it('rejects targeted invalidation while raw evidence hashing is in flight', async () => {
    const runId = 'procedure-invalidated-during-raw-hash';
    const session = await createSession(runId);
    const outcome = await listOutcome(runId);
    await planList(session, runId);
    const deferred = deferNextCryptoDigest();

    const observing = session.observeRawOutcome(outcome);
    await deferred.started;
    expect(invalidateVerifiedProcedureObservationsForExecutionRun(runId)).toEqual({
      status: 'invalidated',
      deletedCount: 0,
    });
    deferred.release();
    await observing;

    await expect(seal(session)).resolves.toBeNull();
  });

  it('does not let a fresh later binding legitimize evidence from a revoked origin', async () => {
    const runId = 'procedure-restrictive-update';
    const session = await createSession(runId);
    await observeList(session, runId);

    expect(invalidateVerifiedProcedureObservationsForExecutionRun(runId)).toEqual({
      status: 'invalidated',
      deletedCount: 0,
    });

    await observeCreate(session, runId);
    await expect(seal(session)).resolves.toBeNull();
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_verified_procedure_observations',
      )?.count,
    ).toBe(0);
  });

  it('does not revoke admitted evidence when its own record advances advisory projection', async () => {
    const runId = 'procedure-advisory-projection-update';
    const session = await createSession(runId);
    await observeList(session, runId, buildCurrentProcedureAwareBinding());
    await observeCreate(session, runId, buildCurrentProcedureAwareBinding());
    const pending = await seal(session);
    expect(pending).not.toBeNull();

    await expect(
      commitPendingVerifiedProcedureObservation({
        memoryLineage: memoryLineage(runId),
        pending: pending!,
        surface: 'foreground',
        terminalObservedAt: OBSERVED_AT + 2,
      }),
    ).resolves.toMatchObject({ status: 'recorded' });
  });

  it('rejects a sealed candidate when its originating authority is later revoked', async () => {
    const runId = 'procedure-revoked-after-seal';
    const session = await createSession(runId);
    await observeList(session, runId);
    await observeCreate(session, runId);
    const pending = await seal(session);
    expect(pending).not.toBeNull();

    expect(invalidateVerifiedProcedureObservationsForExecutionRun(runId)).toEqual({
      status: 'invalidated',
      deletedCount: 0,
    });

    await expect(
      commitPendingVerifiedProcedureObservation({
        memoryLineage: memoryLineage(runId),
        pending: pending!,
        surface: 'foreground',
        terminalObservedAt: OBSERVED_AT + 2,
      }),
    ).resolves.toEqual({ status: 'rejected', code: 'memory_authority_changed' });
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_verified_procedure_observations',
      )?.count,
    ).toBe(0);
  });

  it('rechecks originating authority after asynchronous commit work', async () => {
    const runId = 'procedure-revoked-during-commit';
    const session = await createSession(runId);
    await observeList(session, runId);
    await observeCreate(session, runId);
    const pending = await seal(session);
    expect(pending).not.toBeNull();
    const deferred = deferNextCryptoDigest();

    const committing = commitPendingVerifiedProcedureObservation({
      memoryLineage: memoryLineage(runId),
      pending: pending!,
      surface: 'foreground',
      terminalObservedAt: OBSERVED_AT + 2,
    });
    await deferred.started;
    expect(invalidateVerifiedProcedureObservationsForExecutionRun(runId)).toEqual({
      status: 'invalidated',
      deletedCount: 0,
    });
    deferred.release();

    await expect(committing).resolves.toEqual({
      status: 'rejected',
      code: 'memory_authority_changed',
    });
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_verified_procedure_observations',
      )?.count,
    ).toBe(0);
  });
});
