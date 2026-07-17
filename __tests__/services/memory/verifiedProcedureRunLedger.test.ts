jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import * as Crypto from 'expo-crypto';
import { buildToolEffectReceipt } from '../../../src/engine/toolExecution/toolEffectReceipt';
import type { ToolEffectReceipt } from '../../../src/types/toolEffectReceipt';
import {
  claimVerifiedProcedureLedgerCandidate,
  createVerifiedProcedureRunLedger,
  type VerifiedProcedureRawOutcome,
} from '../../../src/services/memory/verifiedProcedure/runLedger';
import { buildCurrentDurableModelEffectAuthority } from '../../helpers/modelTurnMemoryAuthority';
import { closeMemoryDb } from '../../../src/services/memory/database';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

const RUN_ID = 'verified-procedure-test-run';
const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

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

async function receipt(params: {
  toolCallId: string;
  toolName: string;
  argumentsText: string;
  resultText: string;
  executionRunId?: string;
  recordedAt?: number;
  transportState?: 'returned' | 'rejected';
  terminalEffectState?: 'cancelled' | 'failed';
}): Promise<ToolEffectReceipt> {
  return buildToolEffectReceipt({
    toolCallId: params.toolCallId,
    toolName: params.toolName,
    argumentsText: params.argumentsText,
    resultText: params.resultText,
    executionRunId: params.executionRunId ?? RUN_ID,
    recordedAt: params.recordedAt ?? 100,
    transportState: params.transportState ?? 'returned',
    ...(params.terminalEffectState ? { terminalEffectState: params.terminalEffectState } : {}),
  });
}

async function listOutcome(
  params: {
    iteration?: number;
    batchIndex?: number;
    toolCallId?: string;
    calendarId?: string;
    allowsModifications?: unknown;
    resultText?: string;
    recordedAt?: number;
  } = {},
): Promise<VerifiedProcedureRawOutcome> {
  const argumentsText = '{}';
  const resultText =
    params.resultText ??
    JSON.stringify([
      {
        id: params.calendarId ?? 'private-calendar-id',
        allowsModifications: params.allowsModifications ?? true,
        title: 'Private title that must not be retained',
      },
    ]);
  const toolCallId = params.toolCallId ?? 'list-call';
  return {
    iteration: params.iteration ?? 1,
    batchIndex: params.batchIndex ?? 0,
    toolCallId,
    toolName: 'calendar_list',
    argumentsText,
    resultText,
    receipt: await receipt({
      toolCallId,
      toolName: 'calendar_list',
      argumentsText,
      resultText,
      recordedAt: params.recordedAt,
    }),
  };
}

async function createOutcome(
  params: {
    iteration?: number;
    batchIndex?: number;
    toolCallId?: string;
    calendarId?: string;
    resultCalendarId?: string;
    eventId?: string;
    recordedAt?: number;
    transportState?: 'returned' | 'rejected';
    terminalEffectState?: 'cancelled' | 'failed';
  } = {},
): Promise<VerifiedProcedureRawOutcome> {
  const calendarId = params.calendarId ?? 'private-calendar-id';
  const argumentsText = JSON.stringify({
    title: 'Private dentist appointment',
    startDate: '2026-08-01T10:00:00.000Z',
    endDate: '2026-08-01T11:00:00.000Z',
    calendarId,
  });
  const resultText =
    params.transportState === 'rejected'
      ? JSON.stringify({ error: 'cancelled' })
      : JSON.stringify({
          status: 'created_verified',
          eventId: params.eventId ?? 'private-event-id',
          calendarId: params.resultCalendarId ?? calendarId,
        });
  const toolCallId = params.toolCallId ?? 'create-call';
  return {
    iteration: params.iteration ?? 2,
    batchIndex: params.batchIndex ?? 0,
    toolCallId,
    toolName: 'calendar_create_event',
    argumentsText,
    resultText,
    receipt: await receipt({
      toolCallId,
      toolName: 'calendar_create_event',
      argumentsText,
      resultText,
      recordedAt: params.recordedAt ?? 200,
      transportState: params.transportState,
      terminalEffectState: params.terminalEffectState,
    }),
  };
}

async function eventsOutcome(
  params: {
    iteration?: number;
    batchIndex?: number;
    toolCallId?: string;
    eventId?: string;
    resultText?: string;
    recordedAt?: number;
  } = {},
): Promise<VerifiedProcedureRawOutcome> {
  const argumentsText = JSON.stringify({
    startDate: '2026-08-01T00:00:00.000Z',
    endDate: '2026-08-02T00:00:00.000Z',
  });
  const resultText =
    params.resultText ??
    JSON.stringify([
      {
        id: params.eventId ?? 'private-event-id',
        title: 'Private event title',
        startDate: '2026-08-01T10:00:00.000Z',
        endDate: '2026-08-01T11:00:00.000Z',
      },
    ]);
  const toolCallId = params.toolCallId ?? 'events-call';
  return {
    iteration: params.iteration ?? 1,
    batchIndex: params.batchIndex ?? 0,
    toolCallId,
    toolName: 'calendar_events',
    argumentsText,
    resultText,
    receipt: await receipt({
      toolCallId,
      toolName: 'calendar_events',
      argumentsText,
      resultText,
      recordedAt: params.recordedAt,
    }),
  };
}

async function updateOutcome(
  params: {
    iteration?: number;
    batchIndex?: number;
    toolCallId?: string;
    eventId?: string;
    resultEventId?: string;
    recordedAt?: number;
  } = {},
): Promise<VerifiedProcedureRawOutcome> {
  const eventId = params.eventId ?? 'private-event-id';
  const argumentsText = JSON.stringify({
    id: eventId,
    startDate: '2026-08-01T12:00:00.000Z',
    endDate: '2026-08-01T13:00:00.000Z',
  });
  const resultText = JSON.stringify({
    status: 'updated_verified',
    eventId: params.resultEventId ?? eventId,
  });
  const toolCallId = params.toolCallId ?? 'update-call';
  return {
    iteration: params.iteration ?? 2,
    batchIndex: params.batchIndex ?? 0,
    toolCallId,
    toolName: 'calendar_update_event',
    argumentsText,
    resultText,
    receipt: await receipt({
      toolCallId,
      toolName: 'calendar_update_event',
      argumentsText,
      resultText,
      recordedAt: params.recordedAt ?? 200,
    }),
  };
}

async function ledger(
  registryKey:
    | 'calendar-list-to-create-event'
    | 'calendar-events-to-update-event' = 'calendar-list-to-create-event',
) {
  const runLedger = await createVerifiedProcedureRunLedger({
    registryKey,
    runId: RUN_ID,
  });
  const authorityGuard = () => true;
  return {
    descriptor: runLedger.descriptor,
    observe: (input: VerifiedProcedureRawOutcome) => runLedger.observe(input, authorityGuard),
    markCancelled: () => runLedger.markCancelled(),
    markAmbiguous: () => runLedger.markAmbiguous(),
    finalize: () =>
      runLedger.finalize({
        isCurrent: authorityGuard,
        modelEffectAuthorities: [buildCurrentDurableModelEffectAuthority()],
      }),
  };
}

function deferNextCryptoDigest() {
  const digest = jest.mocked(Crypto.digest);
  const original = digest.getMockImplementation();
  if (!original) throw new Error('crypto_digest_mock_unavailable');
  let releaseGate: () => void = () => undefined;
  let announceStarted: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const started = new Promise<void>((resolve) => {
    announceStarted = resolve;
  });
  digest.mockImplementationOnce(async (...args) => {
    announceStarted();
    await gate;
    return original(...args);
  });
  return { started, release: releaseGate };
}

describe('verified procedure run ledger', () => {
  it('fences cancellation that races an in-flight observation', async () => {
    const runLedger = await ledger();
    const outcome = await listOutcome();
    const deferred = deferNextCryptoDigest();
    const observing = runLedger.observe(outcome);
    await deferred.started;
    runLedger.markCancelled();
    deferred.release();

    await expect(observing).resolves.toEqual({ status: 'rejected', reason: 'cancelled' });
    await expect(runLedger.finalize()).resolves.toEqual({
      status: 'rejected',
      reason: 'cancelled',
    });
  });

  it('fences cancellation that races final candidate hashing', async () => {
    const runLedger = await ledger();
    await runLedger.observe(await listOutcome());
    await runLedger.observe(await createOutcome());
    const deferred = deferNextCryptoDigest();
    const finalizing = runLedger.finalize();
    await deferred.started;
    runLedger.markCancelled();
    deferred.release();

    await expect(finalizing).resolves.toEqual({ status: 'rejected', reason: 'cancelled' });
    await expect(runLedger.finalize()).resolves.toEqual({
      status: 'rejected',
      reason: 'cancelled',
    });
  });

  it('issues one-shot candidate authority and rejects structural copies', async () => {
    const runLedger = await ledger();
    await runLedger.observe(await listOutcome());
    await runLedger.observe(await createOutcome());
    const finalized = await runLedger.finalize();
    if (finalized.status !== 'verified') throw new Error('candidate_not_verified');

    expect(claimVerifiedProcedureLedgerCandidate({ ...finalized.candidate })).toBeNull();
    expect(claimVerifiedProcedureLedgerCandidate(finalized.candidate)).toMatchObject({
      candidate: finalized.candidate,
      memoryPolicyEpoch: expect.any(Number),
      runIdDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(claimVerifiedProcedureLedgerCandidate(finalized.candidate)).toBeNull();
  });

  it('accepts one serial linked and verified calendar procedure without retaining payload content', async () => {
    const runLedger = await ledger();

    await expect(runLedger.observe(await listOutcome())).resolves.toEqual({
      status: 'accepted',
      stepKey: 'calendar-list',
    });
    await expect(runLedger.observe(await createOutcome())).resolves.toEqual({
      status: 'accepted',
      stepKey: 'calendar-create-event',
    });
    const finalized = await runLedger.finalize();

    expect(finalized).toMatchObject({
      status: 'verified',
      candidate: {
        contractVersion: 1,
        procedureId: expect.stringMatching(/^verified-procedure\./u),
        procedureContractDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        evidenceId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        linkageDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        observedAt: 200,
        steps: [
          expect.objectContaining({ stepKey: 'calendar-list', iteration: 1, batchIndex: 0 }),
          expect.objectContaining({
            stepKey: 'calendar-create-event',
            iteration: 2,
            batchIndex: 0,
          }),
        ],
      },
    });
    const serialized = JSON.stringify(finalized);
    for (const privateValue of [
      RUN_ID,
      'private-calendar-id',
      'private-event-id',
      'Private dentist appointment',
      'Private title that must not be retained',
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(serialized).not.toMatch(/argumentsText|resultText|resource/u);
  });

  it('accepts one serial exact event lookup and verified update without retaining event data', async () => {
    const runLedger = await ledger('calendar-events-to-update-event');

    await expect(runLedger.observe(await eventsOutcome())).resolves.toEqual({
      status: 'accepted',
      stepKey: 'calendar-events',
    });
    await expect(runLedger.observe(await updateOutcome())).resolves.toEqual({
      status: 'accepted',
      stepKey: 'calendar-update-event',
    });
    const finalized = await runLedger.finalize();

    expect(finalized).toMatchObject({
      status: 'verified',
      candidate: {
        procedureId: expect.stringMatching(
          /^verified-procedure\.calendar-events-to-update-event\.v1\./u,
        ),
        observedAt: 200,
        steps: [
          expect.objectContaining({ stepKey: 'calendar-events', iteration: 1 }),
          expect.objectContaining({ stepKey: 'calendar-update-event', iteration: 2 }),
        ],
      },
    });
    const serialized = JSON.stringify(finalized);
    expect(serialized).not.toContain('private-event-id');
    expect(serialized).not.toContain('Private event title');
  });

  it('rejects an update whose event id was not observed in the current source result', async () => {
    const runLedger = await ledger('calendar-events-to-update-event');
    await runLedger.observe(await eventsOutcome({ eventId: 'observed-event' }));
    await runLedger.observe(await updateOutcome({ eventId: 'different-event' }));

    await expect(runLedger.finalize()).resolves.toEqual({
      status: 'rejected',
      reason: 'invalid_linkage',
    });
  });

  it('recomputes request and result digests and rejects receipt or run substitution', async () => {
    const tamperedResultLedger = await ledger();
    const list = await listOutcome();
    await expect(
      tamperedResultLedger.observe({
        ...list,
        resultText: JSON.stringify([{ id: 'different', allowsModifications: true }]),
      }),
    ).resolves.toEqual({ status: 'rejected', reason: 'invalid_receipt' });

    const wrongRunLedger = await ledger();
    const wrongRun = await listOutcome();
    const wrongRunReceipt = await receipt({
      toolCallId: wrongRun.toolCallId,
      toolName: wrongRun.toolName,
      argumentsText: wrongRun.argumentsText,
      resultText: wrongRun.resultText,
      executionRunId: 'different-run',
    });
    await expect(
      wrongRunLedger.observe({ ...wrongRun, receipt: wrongRunReceipt }),
    ).resolves.toEqual({
      status: 'rejected',
      reason: 'invalid_receipt',
    });
  });

  it('requires literal writable IDs and an explicit create calendarId/result/resource linkage', async () => {
    const malformedListLedger = await ledger();
    await expect(
      malformedListLedger.observe(await listOutcome({ allowsModifications: 'true' })),
    ).resolves.toEqual({ status: 'rejected', reason: 'invalid_outcome' });

    const unlistedLinkLedger = await ledger();
    await unlistedLinkLedger.observe(await listOutcome({ calendarId: 'writable-calendar' }));
    await unlistedLinkLedger.observe(await createOutcome({ calendarId: 'different-calendar' }));
    await expect(unlistedLinkLedger.finalize()).resolves.toEqual({
      status: 'rejected',
      reason: 'invalid_linkage',
    });

    const mismatchedResultLedger = await ledger();
    await mismatchedResultLedger.observe(await listOutcome());
    await expect(
      mismatchedResultLedger.observe(
        await createOutcome({ resultCalendarId: 'different-calendar' }),
      ),
    ).resolves.toEqual({ status: 'rejected', reason: 'invalid_linkage' });
  });

  it('accepts exact delivery replay but rejects retries and coordinate ambiguity', async () => {
    const replayLedger = await ledger();
    const list = await listOutcome();
    await expect(replayLedger.observe(list)).resolves.toMatchObject({ status: 'accepted' });
    await expect(replayLedger.observe(list)).resolves.toEqual({
      status: 'unchanged',
      stepKey: 'calendar-list',
    });

    const retryLedger = await ledger();
    await retryLedger.observe(await listOutcome());
    await expect(
      retryLedger.observe(
        await listOutcome({ iteration: 2, toolCallId: 'list-retry', recordedAt: 150 }),
      ),
    ).resolves.toEqual({ status: 'rejected', reason: 'retry_detected' });

    const ambiguousLedger = await ledger();
    await ambiguousLedger.observe(await listOutcome());
    await expect(
      ambiguousLedger.observe(
        await listOutcome({ iteration: 1, toolCallId: 'different-list-call', recordedAt: 150 }),
      ),
    ).resolves.toEqual({ status: 'rejected', reason: 'ambiguous_coordinate' });
  });

  it('rejects parallel batches, reversed serial order, and more than one create', async () => {
    const parallelLedger = await ledger();
    await parallelLedger.observe(await listOutcome({ iteration: 1, batchIndex: 0 }));
    await expect(
      parallelLedger.observe(await createOutcome({ iteration: 1, batchIndex: 1 })),
    ).resolves.toEqual({ status: 'rejected', reason: 'parallel_execution' });

    const reversedLedger = await ledger();
    await reversedLedger.observe(await createOutcome({ iteration: 1 }));
    await reversedLedger.observe(await listOutcome({ iteration: 2 }));
    await expect(reversedLedger.finalize()).resolves.toEqual({
      status: 'rejected',
      reason: 'invalid_linkage',
    });

    const duplicateCreateLedger = await ledger();
    await duplicateCreateLedger.observe(await listOutcome());
    await duplicateCreateLedger.observe(await createOutcome());
    await expect(
      duplicateCreateLedger.observe(
        await createOutcome({ iteration: 3, toolCallId: 'create-retry', recordedAt: 300 }),
      ),
    ).resolves.toEqual({ status: 'rejected', reason: 'retry_detected' });
  });

  it('rejects receipt chronology that contradicts the serial coordinates', async () => {
    const runLedger = await ledger();
    await runLedger.observe(await listOutcome({ recordedAt: 300 }));
    await runLedger.observe(await createOutcome({ recordedAt: 200 }));

    await expect(runLedger.finalize()).resolves.toEqual({
      status: 'rejected',
      reason: 'invalid_linkage',
    });
  });

  it('fails closed for cancellation before or during the effectful step', async () => {
    const explicitCancellationLedger = await ledger();
    explicitCancellationLedger.markCancelled();
    await expect(explicitCancellationLedger.observe(await listOutcome())).resolves.toEqual({
      status: 'rejected',
      reason: 'cancelled',
    });

    const receiptCancellationLedger = await ledger();
    await receiptCancellationLedger.observe(await listOutcome());
    await expect(
      receiptCancellationLedger.observe(
        await createOutcome({ transportState: 'rejected', terminalEffectState: 'cancelled' }),
      ),
    ).resolves.toEqual({ status: 'rejected', reason: 'cancelled' });
  });

  it('rejects integrity-valid runtime-external receipts instead of treating them as procedure evidence', async () => {
    const runLedger = await ledger();
    const toolName = 'mcp__test__calendar_lookup';
    const argumentsText = '{}';
    const resultText = '{}';
    const externalReceipt = await buildToolEffectReceipt({
      toolCallId: 'external-call',
      toolName,
      argumentsText,
      resultText,
      transportState: 'returned',
      executionRunId: RUN_ID,
      recordedAt: 100,
      runtimeExternalEvidence: {
        declaration: {
          name: toolName,
          description: 'Runtime calendar lookup',
          input_schema: { type: 'object', properties: {} },
        },
        provenance: {
          source: 'mcp',
          namespace: 'test',
          connectionGeneration: 1,
          toolRegistryGeneration: 1,
          runtimeProcessEpoch: 'test-process-epoch',
          targetIdentity: 'https://example.test/mcp',
          transport: 'streamable-http',
        },
      },
    });

    await expect(
      runLedger.observe({
        iteration: 1,
        batchIndex: 0,
        toolCallId: 'external-call',
        toolName,
        argumentsText,
        resultText,
        receipt: externalReceipt,
      }),
    ).resolves.toEqual({ status: 'rejected', reason: 'invalid_receipt' });
  });
});
