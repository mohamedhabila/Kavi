jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { buildToolEffectReceipt } from '../../../src/engine/toolExecution/toolEffectReceipt';
import type { PreparedAgentTurn } from '../../../src/engine/graph/agentTurnPreparation';
import { buildMemoryPromptDispatchGuard } from '../../../src/engine/graph/modelTurn/memoryPromptDispatchFence';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { calendarVerifiedProcedureApplicablePreconditionIds } from '../../../src/services/memory/verifiedProcedure/calendarPreconditionContract';
import { getCurrentVerifiedProcedureDescriptor } from '../../../src/services/memory/verifiedProcedure/descriptorRegistry';
import { invalidateVerifiedProcedureObservationsForExecutionRun } from '../../../src/services/memory/verifiedProcedure/invalidation';
import {
  issueVerifiedProcedureTerminalCommitAuthority,
  recordVerifiedProcedureObservation,
  type VerifiedProcedureObservationScope,
} from '../../../src/services/memory/verifiedProcedure/observationStore';
import { readVerifiedProcedurePromotionState } from '../../../src/services/memory/verifiedProcedure/observationPromotion';
import { isVerifiedProcedureObservationRevisionCurrent } from '../../../src/services/memory/verifiedProcedure/observationRevision';
import { createVerifiedProcedureRunLedger } from '../../../src/services/memory/verifiedProcedure/runLedger';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const NOW = 30_000_000_000;
const PRECONDITIONS = calendarVerifiedProcedureApplicablePreconditionIds('ios');
let procedureId = '';
let procedureContractDigest: `sha256:${string}` = `sha256:${'0'.repeat(64)}`;

beforeAll(async () => {
  const descriptor = await getCurrentVerifiedProcedureDescriptor('calendar-list-to-create-event');
  procedureId = descriptor.procedureId;
  procedureContractDigest = descriptor.contractDigest;
});

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  closeMemoryDb();
});

function observationScope(): VerifiedProcedureObservationScope {
  return {
    contractVersion: 1,
    procedureId,
    procedureContractDigest,
    platform: 'ios',
    preconditionIds: PRECONDITIONS,
  };
}

async function verifiedCandidate(sourceRunId: string) {
  const ledger = await createVerifiedProcedureRunLedger({
    registryKey: 'calendar-list-to-create-event',
    runId: sourceRunId,
  });
  const calendarId = `calendar-${sourceRunId}`;
  const listResult = JSON.stringify([{ id: calendarId, allowsModifications: true }]);
  await ledger.observe({
    iteration: 1,
    batchIndex: 0,
    toolCallId: `list-${sourceRunId}`,
    toolName: 'calendar_list',
    argumentsText: '{}',
    resultText: listResult,
    receipt: await buildToolEffectReceipt({
      executionRunId: sourceRunId,
      toolCallId: `list-${sourceRunId}`,
      toolName: 'calendar_list',
      argumentsText: '{}',
      resultText: listResult,
      transportState: 'returned',
      recordedAt: NOW - 3,
    }),
  });
  const createArguments = JSON.stringify({
    title: 'Private appointment',
    startDate: '2026-08-01T10:00:00.000Z',
    endDate: '2026-08-01T11:00:00.000Z',
    calendarId,
  });
  const createResult = JSON.stringify({
    status: 'created_verified',
    eventId: `event-${sourceRunId}`,
    calendarId,
  });
  await ledger.observe({
    iteration: 2,
    batchIndex: 0,
    toolCallId: `create-${sourceRunId}`,
    toolName: 'calendar_create_event',
    argumentsText: createArguments,
    resultText: createResult,
    receipt: await buildToolEffectReceipt({
      executionRunId: sourceRunId,
      toolCallId: `create-${sourceRunId}`,
      toolName: 'calendar_create_event',
      argumentsText: createArguments,
      resultText: createResult,
      transportState: 'returned',
      recordedAt: NOW - 2,
    }),
  });
  const finalized = await ledger.finalize();
  if (finalized.status !== 'verified') throw new Error(`candidate_${finalized.reason}`);
  return finalized.candidate;
}

async function authority(sourceRunId: string) {
  const issued = await issueVerifiedProcedureTerminalCommitAuthority({
    candidate: await verifiedCandidate(sourceRunId),
    memoryLineage: {
      sourceMessageId: `message-${sourceRunId}`,
      sourceTurnId: `turn-${sourceRunId}`,
      sourceRunId,
      taskId: null,
    },
    memoryConversationId: 'memory-conversation-1',
    sourceThreadId: 'source-thread-1',
    sourceRunId,
    platform: 'ios',
    preconditionIds: PRECONDITIONS,
    graphProofDigest: `sha256:${'e'.repeat(64)}`,
    surface: 'foreground',
    terminalObservedAt: NOW - 1,
  });
  if (issued.status !== 'issued') throw new Error(`authority_${issued.status}_${issued.code}`);
  return issued.authority;
}

async function recordRun(sourceRunId: string) {
  return recordVerifiedProcedureObservation(await authority(sourceRunId), NOW);
}

describe('verified procedure invalidation fence', () => {
  it('prevents a sealed pre-invalidation authority from inserting an observation', async () => {
    const sourceRunId = 'sealed-run';
    const sealedAuthority = await authority(sourceRunId);

    expect(invalidateVerifiedProcedureObservationsForExecutionRun(sourceRunId)).toEqual({
      status: 'invalidated',
      deletedCount: 0,
    });
    await expect(recordVerifiedProcedureObservation(sealedAuthority, NOW)).resolves.toEqual({
      status: 'rejected',
      code: 'execution_run_invalidated',
    });
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_verified_procedure_observations',
      )?.count,
    ).toBe(0);
    expect(
      getMemoryDb().getFirstSync<{
        source_run_id_hash: string;
        observation_revision: number;
      }>(
        'SELECT source_run_id_hash, observation_revision FROM memory_verified_procedure_run_invalidations',
      ),
    ).toEqual({
      source_run_id_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      observation_revision: 1,
    });
  });

  it('makes a prepared advisory revision stale after targeted invalidation', async () => {
    await recordRun('advisory-run-1');
    await recordRun('advisory-run-2');
    await recordRun('advisory-run-3');
    const promoted = await readVerifiedProcedurePromotionState(observationScope(), NOW);
    if (!promoted.observationRevision) throw new Error('expected observation revision');

    expect(promoted.status).toBe('promoted');
    expect(isVerifiedProcedureObservationRevisionCurrent(promoted.observationRevision)).toBe(true);
    const preparedTurn: PreparedAgentTurn = {
      enrichedSystemPrompt: 'Verified procedure advisory',
      enrichedSystemPromptSections: [{ text: 'Verified procedure advisory', cacheable: false }],
      pinnedToolNames: [],
      selectedToolTokenEstimate: 0,
      selectedTools: [],
      toolsForIteration: undefined,
      memoryReadFence: {
        readEpoch: promoted.readEpoch!,
        verifiedProcedureObservationRevision: promoted.observationRevision,
        memoryFreePrompt: {
          enrichedSystemPrompt: 'Memory-free prompt',
          enrichedSystemPromptSections: [{ text: 'Memory-free prompt' }],
        },
      },
    };
    const dispatchGuard = buildMemoryPromptDispatchGuard(preparedTurn);

    expect(invalidateVerifiedProcedureObservationsForExecutionRun('advisory-run-2')).toEqual({
      status: 'invalidated',
      deletedCount: 1,
    });
    expect(isVerifiedProcedureObservationRevisionCurrent(promoted.observationRevision)).toBe(false);
    expect(() => dispatchGuard?.()).toThrow('memory_prompt_epoch_expired');
    await expect(
      readVerifiedProcedurePromotionState(observationScope(), NOW),
    ).resolves.toMatchObject({
      status: 'insufficient',
      successfulRunCount: 2,
      observationRevision: { value: 4 },
    });
  });
});
