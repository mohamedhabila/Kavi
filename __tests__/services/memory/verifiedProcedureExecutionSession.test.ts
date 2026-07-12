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
}));

import { createInitialAgentControlGraphSnapshot } from '../../../src/engine/graph/agentControlGraph';
import { buildToolEffectReceipt } from '../../../src/engine/toolExecution/toolEffectReceipt';
import { CALENDAR_CREATE_TOOL } from '../../../src/engine/tools/native/calendar/definitions';
import { closeMemoryDb } from '../../../src/services/memory/database';
import { getMemoryDb } from '../../../src/services/memory/database';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { withdrawMemoryFact } from '../../../src/services/memory/withdrawal';
import { invalidateVerifiedProcedureObservationsForExecutionRun } from '../../../src/services/memory/verifiedProcedure/invalidation';
import {
  commitPendingVerifiedProcedureObservation,
  createVerifiedProcedureExecutionSession,
  type PendingVerifiedProcedureObservation,
  type VerifiedProcedureExecutionSession,
} from '../../../src/services/memory/verifiedProcedure/executionSession';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { buildAssistantMessageMetadata } from '../../../src/utils/assistantMessageMetadata';
import {
  hashVerifiedProcedureProvenanceSync,
  type VerifiedProcedureMemoryLineage,
} from '../../../src/services/memory/verifiedProcedure/provenanceHash';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const OBSERVED_AT = Date.now() - 1_000;

async function observeList(session: VerifiedProcedureExecutionSession, runId: string) {
  const resultText = JSON.stringify([
    {
      id: 'private-calendar-id',
      title: 'Private calendar title',
      allowsModifications: true,
    },
  ]);
  await session.observePlannedBatch({
    iteration: 1,
    executeInParallel: false,
    toolCalls: [{ batchIndex: 0, toolCallId: `${runId}-list`, toolName: 'calendar_list' }],
  });
  await session.observeRawOutcome({
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
  });
}

async function observeCreate(session: VerifiedProcedureExecutionSession, runId: string) {
  const argumentsText = JSON.stringify({
    title: 'Private appointment',
    startDate: '2026-08-01T10:00:00.000Z',
    endDate: '2026-08-01T11:00:00.000Z',
    calendarId: 'private-calendar-id',
  });
  const resultText = JSON.stringify({
    status: 'created_verified',
    eventId: 'private-event-id',
    calendarId: 'private-calendar-id',
  });
  await session.observePlannedBatch({
    iteration: 2,
    executeInParallel: false,
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
      recordedAt: OBSERVED_AT + 100,
    }),
  });
}

async function createSession(
  runId: string,
  scope: { memoryConversationId?: string; sourceThreadId?: string } = {},
): Promise<VerifiedProcedureExecutionSession> {
  const session = await createVerifiedProcedureExecutionSession({
    executionRunId: runId,
    memoryConversationId: scope.memoryConversationId ?? `memory-${runId}`,
    sourceThreadId: scope.sourceThreadId ?? `thread-${runId}`,
  });
  if (!session) throw new Error('verified procedure session unavailable');
  return session;
}

function memoryLineage(
  id: string,
  overrides: Partial<VerifiedProcedureMemoryLineage> = {},
): VerifiedProcedureMemoryLineage {
  return {
    sourceMessageId: `user-message-${id}`,
    sourceRunId: `agent-run-${id}`,
    sourceTurnId: `assistant-turn-${id}`,
    taskId: null,
    ...overrides,
  };
}

async function recordDurableProcedure(params: {
  executionRunId: string;
  memoryConversationId: string;
  sourceThreadId: string;
  lineage: VerifiedProcedureMemoryLineage;
  terminalObservedAt: number;
}): Promise<string> {
  const session = await createSession(params.executionRunId, params);
  await observeList(session, params.executionRunId);
  await observeCreate(session, params.executionRunId);
  const pending = await seal(session);
  const recorded = await commitPendingVerifiedProcedureObservation({
    memoryLineage: params.lineage,
    pending: pending!,
    surface: 'foreground',
    terminalObservedAt: params.terminalObservedAt,
  });
  if (recorded.status !== 'recorded') throw new Error(`procedure_${recorded.status}`);
  return recorded.observationId;
}

async function seal(session: VerifiedProcedureExecutionSession) {
  return session.sealGraphCandidate({
    graphSnapshot: createInitialAgentControlGraphSnapshot({
      status: 'awaiting_review',
      iteration: 3,
      pendingAsyncCount: 0,
      asyncWork: { awaitingBackgroundWorkers: false, pendingOperations: [], updatedAt: 300 },
    }),
    finalAssistant: {
      content: 'The requested calendar event was created and verified.',
      metadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'complete',
        finishReason: 'stop',
      }),
    },
  });
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

describe('verified procedure execution session', () => {
  it('promotes only durable exact runs and exposes a bounded same-run advisory', async () => {
    for (let index = 0; index < 3; index += 1) {
      const runId = `verified-execution-${index}`;
      const session = await createSession(runId);
      await observeList(session, runId);
      await expect(session.buildApplicableAdvisory([CALENDAR_CREATE_TOOL])).resolves.toBeNull();
      await observeCreate(session, runId);
      const pending = await seal(session);
      expect(JSON.stringify(pending)).not.toContain('private-');
      await expect(
        commitPendingVerifiedProcedureObservation({
          memoryLineage: memoryLineage(runId),
          pending: pending!,
          surface: (['foreground', 'scheduler', 'subagent'] as const)[index]!,
          terminalObservedAt: OBSERVED_AT + 200 + index,
        }),
      ).resolves.toMatchObject({ status: 'recorded' });
    }

    const reuseRun = 'verified-execution-reuse';
    const reuseSession = await createSession(reuseRun);
    await observeList(reuseSession, reuseRun);
    const advisory = await reuseSession.buildApplicableAdvisory([CALENDAR_CREATE_TOOL]);
    expect(advisory).toEqual(
      expect.objectContaining({
        readEpoch: expect.any(Number),
        section: expect.stringContaining('never authorization'),
      }),
    );
    expect(advisory?.section).toContain('current calendar_list result');
    expect(advisory?.section).not.toContain('private-calendar-id');
  });

  it('rejects parallel, extra-tool, skipped, and reconciliation-tainted procedures', async () => {
    const extra = await createSession('extra-tool-run');
    await extra.observePlannedBatch({
      iteration: 1,
      executeInParallel: true,
      toolCalls: [
        { batchIndex: 0, toolCallId: 'list', toolName: 'calendar_list' },
        { batchIndex: 1, toolCallId: 'other', toolName: 'calendar_events' },
      ],
    });
    await expect(seal(extra)).resolves.toBeNull();

    const skipped = await createSession('skipped-step-run');
    await skipped.observePlannedBatch({
      iteration: 1,
      executeInParallel: false,
      toolCalls: [{ batchIndex: 0, toolCallId: 'list', toolName: 'calendar_list' }],
    });
    await expect(seal(skipped)).resolves.toBeNull();

    const reconciled = await createSession('reconciled-run');
    await observeList(reconciled, 'reconciled-run');
    reconciled.markReconciliationRequired();
    await expect(seal(reconciled)).resolves.toBeNull();
  });

  it('allows one pending observation to be consumed exactly once', async () => {
    const runId = 'single-use-run';
    const session = await createSession(runId);
    await observeList(session, runId);
    await observeCreate(session, runId);
    const pending = await seal(session);
    expect(pending).not.toBeNull();

    await expect(
      commitPendingVerifiedProcedureObservation({
        memoryLineage: memoryLineage(runId),
        pending: pending!,
        surface: 'foreground',
        terminalObservedAt: OBSERVED_AT + 200,
      }),
    ).resolves.toMatchObject({ status: 'recorded' });
    await expect(
      commitPendingVerifiedProcedureObservation({
        memoryLineage: memoryLineage(runId),
        pending: pending!,
        surface: 'foreground',
        terminalObservedAt: OBSERVED_AT + 201,
      }),
    ).resolves.toEqual({ status: 'rejected', code: 'invalid_pending_observation' });
    await expect(
      commitPendingVerifiedProcedureObservation({
        memoryLineage: memoryLineage('invalid-pending'),
        pending: {} as PendingVerifiedProcedureObservation,
        surface: 'scheduler',
      }),
    ).resolves.toEqual({ status: 'rejected', code: 'invalid_pending_observation' });
  });

  it('withdraws one exact foreground source while retaining sibling turns and runs', async () => {
    const memoryConversationId = 'memory-foreground-withdrawal';
    const sourceThreadId = 'thread-foreground-withdrawal';
    const targetLineage = memoryLineage('target', {
      sourceRunId: 'agent-run-shared-across-turns',
      taskId: 'task-foreground-withdrawal',
    });
    const siblingTurnLineage = memoryLineage('sibling-turn', {
      sourceRunId: targetLineage.sourceRunId,
      taskId: targetLineage.taskId,
    });
    const siblingRunLineage = memoryLineage('sibling-run', {
      taskId: targetLineage.taskId,
    });
    const targetObservationId = await recordDurableProcedure({
      executionRunId: 'foreground-request-target',
      memoryConversationId,
      sourceThreadId,
      lineage: targetLineage,
      terminalObservedAt: OBSERVED_AT + 200,
    });
    const siblingTurnObservationId = await recordDurableProcedure({
      executionRunId: 'foreground-request-sibling-turn',
      memoryConversationId,
      sourceThreadId,
      lineage: siblingTurnLineage,
      terminalObservedAt: OBSERVED_AT + 201,
    });
    const siblingRunObservationId = await recordDurableProcedure({
      executionRunId: 'foreground-request-sibling-run',
      memoryConversationId,
      sourceThreadId,
      lineage: siblingRunLineage,
      terminalObservedAt: OBSERVED_AT + 202,
    });

    const fact = recordFact({
      subjectId: 'profile-owner',
      predicate: 'calendar_workflow_note',
      objectText: 'Use the verified calendar workflow.',
      scope: 'session',
      originConversationId: memoryConversationId,
      originThreadId: sourceThreadId,
      originTaskId: targetLineage.taskId,
      taskId: targetLineage.taskId,
      sourceMessageId: targetLineage.sourceMessageId,
      sourceRunId: targetLineage.sourceRunId,
      sourceTurnId: targetLineage.sourceTurnId,
      now: OBSERVED_AT + 300,
    }).fact;
    const revisionBeforeWithdrawal = getMemoryDb().getFirstSync<{
      observation_revision: number;
    }>('SELECT observation_revision FROM memory_verified_procedure_state')?.observation_revision;
    const withdrawal = withdrawMemoryFact(fact.id, OBSERVED_AT + 400);
    expect(withdrawal).toMatchObject({
      status: 'withdrawn',
      receipt: { counts: { verifiedProcedureObservations: 1 } },
    });
    expect(
      getMemoryDb().getFirstSync<{ observation_revision: number }>(
        'SELECT observation_revision FROM memory_verified_procedure_state',
      )?.observation_revision,
    ).toBeGreaterThan(revisionBeforeWithdrawal ?? -1);
    expect(
      getMemoryDb()
        .getAllSync<{ id: string }>(
          'SELECT id FROM memory_verified_procedure_observations ORDER BY id',
        )
        .map((row) => row.id),
    ).toEqual([siblingRunObservationId, siblingTurnObservationId].sort());
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count
           FROM memory_verified_procedure_run_invalidations
          WHERE source_run_id_hash = ?`,
        hashVerifiedProcedureProvenanceSync('source-run', 'foreground-request-target'),
      )?.count,
    ).toBe(1);
    expect(targetObservationId).not.toBe(siblingTurnObservationId);
  });

  it('withdraws exact chitchat evidence without an agent run and retains its sibling turn', async () => {
    const memoryConversationId = 'memory-chitchat-withdrawal';
    const sourceThreadId = 'thread-chitchat-withdrawal';
    const targetLineage = memoryLineage('chitchat-target', { sourceRunId: null });
    const siblingLineage = memoryLineage('chitchat-sibling', { sourceRunId: null });
    const targetObservationId = await recordDurableProcedure({
      executionRunId: 'foreground-request-chitchat-target',
      memoryConversationId,
      sourceThreadId,
      lineage: targetLineage,
      terminalObservedAt: OBSERVED_AT + 210,
    });
    const siblingObservationId = await recordDurableProcedure({
      executionRunId: 'foreground-request-chitchat-sibling',
      memoryConversationId,
      sourceThreadId,
      lineage: siblingLineage,
      terminalObservedAt: OBSERVED_AT + 211,
    });
    const fact = recordFact({
      subjectId: 'profile-owner',
      predicate: 'chitchat_calendar_workflow_note',
      objectText: 'Use the chitchat calendar workflow.',
      scope: 'conversation',
      originConversationId: memoryConversationId,
      originThreadId: sourceThreadId,
      sourceMessageId: targetLineage.sourceMessageId,
      sourceTurnId: targetLineage.sourceTurnId,
      now: OBSERVED_AT + 310,
    }).fact;

    expect(withdrawMemoryFact(fact.id, OBSERVED_AT + 410)).toMatchObject({
      status: 'withdrawn',
      receipt: { counts: { verifiedProcedureObservations: 1 } },
    });
    expect(
      getMemoryDb().getAllSync<{ id: string }>(
        'SELECT id FROM memory_verified_procedure_observations',
      ),
    ).toEqual([{ id: siblingObservationId }]);
    expect(targetObservationId).not.toBe(siblingObservationId);
  });

  it('rejects a sealed observation after its exact source is withdrawn before commit', async () => {
    const executionRunId = 'foreground-request-pending-withdrawal';
    const memoryConversationId = 'memory-pending-withdrawal';
    const sourceThreadId = 'thread-pending-withdrawal';
    const lineage = memoryLineage('pending-withdrawal');
    const session = await createSession(executionRunId, {
      memoryConversationId,
      sourceThreadId,
    });
    await observeList(session, executionRunId);
    await observeCreate(session, executionRunId);
    const pending = await seal(session);
    const fact = recordFact({
      subjectId: 'profile-owner',
      predicate: 'pending_calendar_workflow_note',
      objectText: 'Pending workflow source.',
      scope: 'conversation',
      originConversationId: memoryConversationId,
      originThreadId: sourceThreadId,
      sourceMessageId: lineage.sourceMessageId,
      sourceRunId: lineage.sourceRunId,
      sourceTurnId: lineage.sourceTurnId,
      now: OBSERVED_AT + 320,
    }).fact;
    expect(withdrawMemoryFact(fact.id, OBSERVED_AT + 420)).toMatchObject({
      status: 'withdrawn',
    });

    await expect(
      commitPendingVerifiedProcedureObservation({
        memoryLineage: lineage,
        pending: pending!,
        surface: 'foreground',
        terminalObservedAt: OBSERVED_AT + 430,
      }),
    ).resolves.toEqual({ status: 'rejected', code: 'invalid_pending_observation' });
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_verified_procedure_observations',
      )?.count,
    ).toBe(0);
  });

  it('reconciles exact execution evidence without inventing failure', async () => {
    const runId = 'reconciliation-procedure-run';
    await recordDurableProcedure({
      executionRunId: runId,
      memoryConversationId: `memory-${runId}`,
      sourceThreadId: `thread-${runId}`,
      lineage: memoryLineage(runId),
      terminalObservedAt: OBSERVED_AT + 500,
    });
    expect(invalidateVerifiedProcedureObservationsForExecutionRun(runId)).toEqual({
      status: 'invalidated',
      deletedCount: 1,
    });
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_verified_procedure_observations',
      )?.count,
    ).toBe(0);
  });
});
