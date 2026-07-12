jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { buildToolEffectReceipt } from '../../../src/engine/toolExecution/toolEffectReceipt';
import {
  closeMemoryDb,
  getMemoryDb,
  removeRetiredMemoryDatabaseArtifactsAtStartup,
} from '../../../src/services/memory/database';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import * as memoryPolicy from '../../../src/services/memory/policy';
import { calendarVerifiedProcedureApplicablePreconditionIds } from '../../../src/services/memory/verifiedProcedure/calendarPreconditionContract';
import { getCurrentVerifiedProcedureDescriptor } from '../../../src/services/memory/verifiedProcedure/descriptorRegistry';
import {
  issueVerifiedProcedureTerminalCommitAuthority,
  recordVerifiedProcedureObservation,
  type VerifiedProcedureTerminalCommitAuthority,
  type VerifiedProcedureTerminalCommitContext,
  type VerifiedProcedureObservationScope,
} from '../../../src/services/memory/verifiedProcedure/observationStore';
import { readVerifiedProcedurePromotionState } from '../../../src/services/memory/verifiedProcedure/observationPromotion';
import {
  VERIFIED_PROCEDURE_MAX_EVIDENCE_MANIFEST_LENGTH,
  VERIFIED_PROCEDURE_MAX_OBSERVATIONS_PER_OWNER,
  VERIFIED_PROCEDURE_MAX_OBSERVATIONS_PER_SCOPE,
  VERIFIED_PROCEDURE_OBSERVATION_RETENTION_MS,
} from '../../../src/services/memory/verifiedProcedure/policyContract';
import { createVerifiedProcedureRunLedger } from '../../../src/services/memory/verifiedProcedure/runLedger';
import {
  clearStructuredMemory,
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = 300 * DAY_MS;
const IOS_PRECONDITIONS = calendarVerifiedProcedureApplicablePreconditionIds('ios');
const MEMORY_LINEAGE = Object.freeze({
  sourceMessageId: 'memory-source-message-1',
  sourceRunId: 'memory-source-run-1',
  sourceTurnId: 'memory-source-turn-1',
  taskId: null,
});
let currentProcedureId = '';
let currentProcedureContractDigest: `sha256:${string}` = `sha256:${'0'.repeat(64)}`;

beforeAll(async () => {
  const descriptor = await getCurrentVerifiedProcedureDescriptor('calendar-list-to-create-event');
  currentProcedureId = descriptor.procedureId;
  currentProcedureContractDigest = descriptor.contractDigest;
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
  jest.restoreAllMocks();
});

function scope(
  overrides: Partial<VerifiedProcedureObservationScope> = {},
): VerifiedProcedureObservationScope {
  return {
    contractVersion: 1,
    procedureId: currentProcedureId,
    procedureContractDigest: currentProcedureContractDigest,
    platform: 'ios',
    preconditionIds: IOS_PRECONDITIONS,
    ...overrides,
  };
}

async function candidate(sourceRunId: string, terminalObservedAt = NOW - 10) {
  const ledger = await createVerifiedProcedureRunLedger({
    registryKey: 'calendar-list-to-create-event',
    runId: sourceRunId,
  });
  const calendarId = `private-calendar-${sourceRunId}`;
  const listArgumentsText = '{}';
  const listResultText = JSON.stringify([
    {
      id: calendarId,
      allowsModifications: true,
      title: `Private calendar title ${sourceRunId}`,
    },
  ]);
  const listToolCallId = `list-${sourceRunId}`;
  await ledger.observe({
    iteration: 1,
    batchIndex: 0,
    toolCallId: listToolCallId,
    toolName: 'calendar_list',
    argumentsText: listArgumentsText,
    resultText: listResultText,
    receipt: await buildToolEffectReceipt({
      toolCallId: listToolCallId,
      toolName: 'calendar_list',
      argumentsText: listArgumentsText,
      resultText: listResultText,
      transportState: 'returned',
      executionRunId: sourceRunId,
      recordedAt: terminalObservedAt - 2,
    }),
  });

  const createArgumentsText = JSON.stringify({
    title: `Private appointment ${sourceRunId}`,
    startDate: '2026-08-01T10:00:00.000Z',
    endDate: '2026-08-01T11:00:00.000Z',
    calendarId,
  });
  const eventId = `private-event-${sourceRunId}`;
  const createResultText = JSON.stringify({
    status: 'created_verified',
    eventId,
    calendarId,
  });
  const createToolCallId = `create-${sourceRunId}`;
  await ledger.observe({
    iteration: 2,
    batchIndex: 0,
    toolCallId: createToolCallId,
    toolName: 'calendar_create_event',
    argumentsText: createArgumentsText,
    resultText: createResultText,
    receipt: await buildToolEffectReceipt({
      toolCallId: createToolCallId,
      toolName: 'calendar_create_event',
      argumentsText: createArgumentsText,
      resultText: createResultText,
      transportState: 'returned',
      executionRunId: sourceRunId,
      recordedAt: terminalObservedAt - 1,
    }),
  });
  const finalized = await ledger.finalize();
  if (finalized.status !== 'verified') throw new Error(`candidate_${finalized.reason}`);
  return finalized.candidate;
}

async function issueAuthority(
  sourceRunId: string,
  overrides: Partial<VerifiedProcedureTerminalCommitContext> = {},
  terminalObservedAt = NOW - 10,
): Promise<VerifiedProcedureTerminalCommitAuthority> {
  const verifiedCandidate = await candidate(sourceRunId, terminalObservedAt);
  const issued = await issueVerifiedProcedureTerminalCommitAuthority({
    candidate: verifiedCandidate,
    memoryLineage: MEMORY_LINEAGE,
    memoryConversationId: 'memory-conversation-1',
    sourceThreadId: 'source-thread-1',
    sourceRunId,
    platform: 'ios',
    preconditionIds: IOS_PRECONDITIONS,
    graphProofDigest: `sha256:${'e'.repeat(64)}`,
    surface: 'foreground',
    terminalObservedAt,
    ...overrides,
  });
  if (issued.status !== 'issued') throw new Error(`authority_${issued.status}_${issued.code}`);
  return issued.authority;
}

async function recordRun(
  sourceRunId: string,
  overrides: Partial<VerifiedProcedureTerminalCommitContext> = {},
  terminalObservedAt = NOW - 10,
) {
  return recordVerifiedProcedureObservation(
    await issueAuthority(sourceRunId, overrides, terminalObservedAt),
    NOW,
  );
}

describe('verified procedure observation store', () => {
  it('keeps the clean verified-procedure table and removes the retired product table', () => {
    getMemoryDb().execSync(`
      CREATE TABLE memory_product_experience_observations (
        id TEXT PRIMARY KEY,
        private_payload TEXT NOT NULL
      );
      INSERT INTO memory_product_experience_observations(id, private_payload)
      VALUES ('retired-row', 'must-not-migrate');
    `);
    removeRetiredMemoryDatabaseArtifactsAtStartup();
    resetFactSchemaCacheForTests();
    ensureFactSchema();

    expect(
      getMemoryDb().getFirstSync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_verified_procedure_observations'",
      )?.name,
    ).toBe('memory_verified_procedure_observations');
    expect(
      getMemoryDb().getFirstSync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_product_experience_observations'",
      ),
    ).toBeNull();
  });

  it('stores only hashed provenance and a bounded content-free evidence manifest', async () => {
    await expect(recordRun('verified-run-1')).resolves.toEqual({
      status: 'recorded',
      observationId: expect.stringMatching(/^verified_procedure_[a-f0-9]{64}$/u),
      prunedCount: 0,
    });

    const row = getMemoryDb().getFirstSync<Record<string, unknown>>(
      'SELECT * FROM memory_verified_procedure_observations',
    );
    expect(row).toEqual(
      expect.objectContaining({
        memory_owner_id: expect.stringMatching(/^vault_owner_/u),
        memory_conversation_id_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        source_thread_id_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        source_run_id_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        procedure_id: currentProcedureId,
        procedure_contract_digest: currentProcedureContractDigest.slice('sha256:'.length),
        platform: 'ios',
        precondition_ids_json: JSON.stringify(IOS_PRECONDITIONS),
        precondition_ids_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        evidence_manifest_digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        evidence_id_digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        linkage_digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        terminal_proof_digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        contract_version: 1,
        observed_at: NOW - 10,
        created_at: NOW,
      }),
    );
    const manifestJson = String(row?.evidence_manifest_json);
    expect(manifestJson.length).toBeLessThanOrEqual(
      VERIFIED_PROCEDURE_MAX_EVIDENCE_MANIFEST_LENGTH,
    );
    const manifest = JSON.parse(manifestJson) as Record<string, unknown>;
    expect(manifest).toEqual({
      version: 1,
      procedureId: currentProcedureId,
      procedureContractDigest: currentProcedureContractDigest,
      evidenceId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      orderedSteps: [
        {
          stepKey: 'calendar-list',
          receiptId: expect.stringMatching(/^ter_[a-f0-9]{32}$/u),
          contractIdentityDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          requestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          resultDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        },
        {
          stepKey: 'calendar-create-event',
          receiptId: expect.stringMatching(/^ter_[a-f0-9]{32}$/u),
          contractIdentityDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          requestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          resultDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        },
      ],
      linkageDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      sourceLineage: {
        sourceMessageIdHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        sourceRunIdHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        sourceTurnIdHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        taskIdHash: null,
      },
      terminalProofDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(manifest.terminalProofDigest).not.toBe(`sha256:${'e'.repeat(64)}`);
    const serialized = JSON.stringify(row);
    for (const privateValue of [
      'memory-conversation-1',
      'source-thread-1',
      'verified-run-1',
      ...Object.values(MEMORY_LINEAGE).filter((value): value is string => value !== null),
      'private-calendar',
      'private-event',
      'Private appointment',
      'Private calendar title',
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(Object.keys(row ?? {})).not.toEqual(
      expect.arrayContaining(['arguments', 'result', 'text', 'resource_id', 'event_id', 'outcome']),
    );
  });

  it('rejects forged candidates and authorities and consumes genuine capabilities once', async () => {
    const genuineCandidate = await candidate('authority-run');
    const context = {
      candidate: genuineCandidate,
      memoryLineage: MEMORY_LINEAGE,
      memoryConversationId: 'memory-conversation-1',
      sourceThreadId: 'source-thread-1',
      sourceRunId: 'authority-run',
      platform: 'ios' as const,
      preconditionIds: IOS_PRECONDITIONS,
      graphProofDigest: `sha256:${'a'.repeat(64)}` as const,
      surface: 'foreground' as const,
      terminalObservedAt: NOW - 10,
    };
    await expect(
      issueVerifiedProcedureTerminalCommitAuthority({
        ...context,
        candidate: { ...genuineCandidate },
      }),
    ).resolves.toEqual({ status: 'rejected', code: 'invalid_candidate' });
    await expect(
      issueVerifiedProcedureTerminalCommitAuthority({
        ...context,
        terminalProofDigest: `sha256:${'b'.repeat(64)}`,
      } as never),
    ).resolves.toEqual({ status: 'rejected', code: 'invalid_input' });

    const issued = await issueVerifiedProcedureTerminalCommitAuthority(context);
    expect(issued).toMatchObject({ status: 'issued' });
    await expect(issueVerifiedProcedureTerminalCommitAuthority(context)).resolves.toEqual({
      status: 'rejected',
      code: 'invalid_candidate',
    });
    await expect(
      recordVerifiedProcedureObservation({} as VerifiedProcedureTerminalCommitAuthority, NOW),
    ).resolves.toEqual({ status: 'rejected', code: 'invalid_authority' });
    if (issued.status !== 'issued') throw new Error('authority_not_issued');
    await expect(recordVerifiedProcedureObservation(issued.authority, NOW)).resolves.toMatchObject({
      status: 'recorded',
    });
    await expect(recordVerifiedProcedureObservation(issued.authority, NOW)).resolves.toEqual({
      status: 'rejected',
      code: 'invalid_authority',
    });
  });

  it('requires the dynamic writable-calendar observation and exact current contract', async () => {
    const verifiedCandidate = await candidate('precondition-run');
    const base = {
      candidate: verifiedCandidate,
      memoryLineage: MEMORY_LINEAGE,
      memoryConversationId: 'memory-conversation-1',
      sourceThreadId: 'source-thread-1',
      sourceRunId: 'precondition-run',
      platform: 'ios' as const,
      graphProofDigest: `sha256:${'a'.repeat(64)}` as const,
      surface: 'foreground' as const,
      terminalObservedAt: NOW - 10,
    };
    await expect(
      issueVerifiedProcedureTerminalCommitAuthority({
        ...base,
        preconditionIds: IOS_PRECONDITIONS.filter(
          (id) => id !== 'calendar.list.returned-writable-id.v1',
        ),
      }),
    ).resolves.toEqual({ status: 'rejected', code: 'invalid_input' });
    await expect(
      issueVerifiedProcedureTerminalCommitAuthority({
        ...base,
        preconditionIds: IOS_PRECONDITIONS,
        surface: 'voice',
      } as never),
    ).resolves.toEqual({ status: 'rejected', code: 'invalid_input' });

    await expect(
      readVerifiedProcedurePromotionState(
        scope({ procedureContractDigest: `sha256:${'b'.repeat(64)}` }),
        NOW,
      ),
    ).resolves.toEqual({ status: 'unavailable', successfulRunCount: 0 });
  });

  it('promotes across conversations and threads after three distinct verified runs', async () => {
    await recordRun('promotion-run-1', {
      memoryConversationId: 'memory-conversation-1',
      sourceThreadId: 'source-thread-1',
    });
    await recordRun('promotion-run-2', {
      memoryConversationId: 'memory-conversation-2',
      sourceThreadId: 'source-thread-2',
    });
    await expect(readVerifiedProcedurePromotionState(scope(), NOW)).resolves.toMatchObject({
      status: 'insufficient',
      successfulRunCount: 2,
    });

    await recordRun('promotion-run-3', {
      memoryConversationId: 'memory-conversation-3',
      sourceThreadId: 'source-thread-3',
    });
    await expect(readVerifiedProcedurePromotionState(scope(), NOW)).resolves.toMatchObject({
      status: 'promoted',
      successfulRunCount: 3,
      readEpoch: expect.any(Number),
    });
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(DISTINCT memory_conversation_id_hash) AS count FROM memory_verified_procedure_observations',
      )?.count,
    ).toBe(3);
  });

  it('isolates promotion by owner, platform, procedure contract, and exact preconditions', async () => {
    for (let index = 0; index < 3; index += 1) {
      await recordRun(`isolation-run-${index}`);
    }
    await expect(readVerifiedProcedurePromotionState(scope(), NOW)).resolves.toMatchObject({
      status: 'promoted',
    });
    await expect(
      readVerifiedProcedurePromotionState(
        scope({
          platform: 'android',
          preconditionIds: calendarVerifiedProcedureApplicablePreconditionIds('android'),
        }),
        NOW,
      ),
    ).resolves.toMatchObject({ status: 'insufficient', successfulRunCount: 0 });
    await expect(
      readVerifiedProcedurePromotionState(
        scope({ preconditionIds: [...IOS_PRECONDITIONS, 'z.extra'].sort() }),
        NOW,
      ),
    ).resolves.toMatchObject({ status: 'unavailable', successfulRunCount: 0 });

    const db = getMemoryDb();
    db.runSync(
      "UPDATE memory_vault_identity SET owner_id = 'vault_owner_replacement' WHERE singleton = 1",
    );
    await expect(readVerifiedProcedurePromotionState(scope(), NOW)).resolves.toMatchObject({
      status: 'insufficient',
      successfulRunCount: 0,
    });
  });

  it('is idempotent for exact evidence and rejects one run with conflicting provenance', async () => {
    const first = await recordRun('same-run');
    expect(first).toMatchObject({ status: 'recorded' });
    await expect(recordRun('same-run')).resolves.toMatchObject({
      status: 'unchanged',
      observationId:
        first.status === 'recorded' || first.status === 'unchanged' ? first.observationId : '',
    });
    await expect(
      recordRun('same-run', { sourceThreadId: 'source-thread-conflict' }),
    ).resolves.toEqual({ status: 'rejected', code: 'conflicting_run_evidence' });
  });

  it('enforces the retained window and exact-scope row cap', async () => {
    const expiredObservedAt = NOW - VERIFIED_PROCEDURE_OBSERVATION_RETENTION_MS - 1;
    await expect(
      recordVerifiedProcedureObservation(
        await issueAuthority('expired-run', {}, expiredObservedAt),
        NOW,
      ),
    ).resolves.toEqual({ status: 'rejected', code: 'outside_retained_window' });

    for (let index = 0; index <= VERIFIED_PROCEDURE_MAX_OBSERVATIONS_PER_SCOPE; index += 1) {
      await expect(
        recordRun(
          `bounded-run-${index}`,
          {},
          NOW - VERIFIED_PROCEDURE_MAX_OBSERVATIONS_PER_SCOPE + index,
        ),
      ).resolves.toMatchObject({ status: 'recorded' });
    }
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_verified_procedure_observations',
      )?.count,
    ).toBe(VERIFIED_PROCEDURE_MAX_OBSERVATIONS_PER_SCOPE);
  });

  it('enforces the owner cap and prunes expired owner evidence on every write', async () => {
    const db = getMemoryDb();
    const ownerId = getLocalMemoryVaultOwnerId(db);
    const fixedHash = (character: string) => character.repeat(64);
    for (let index = 0; index < VERIFIED_PROCEDURE_MAX_OBSERVATIONS_PER_OWNER + 1; index += 1) {
      const hex = index.toString(16).padStart(64, '0');
      db.runSync(
        `INSERT INTO memory_verified_procedure_observations(
           id, memory_owner_id, memory_conversation_id_hash, source_thread_id_hash,
           source_run_id_hash, procedure_id, procedure_contract_digest, platform,
           precondition_ids_json, precondition_ids_hash, evidence_manifest_json,
           evidence_manifest_digest, evidence_id_digest, linkage_digest,
           terminal_proof_digest, contract_version, observed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ios', '["platform.ios"]', ?, '{}', ?, ?, ?, ?, 1, ?, ?)`,
        `verified_procedure_${hex}`,
        ownerId,
        fixedHash('b'),
        fixedHash('c'),
        hex,
        `seed-procedure-${index}`,
        fixedHash('d'),
        fixedHash('e'),
        fixedHash('1'),
        fixedHash('2'),
        fixedHash('3'),
        fixedHash('4'),
        index === 0 ? NOW - VERIFIED_PROCEDURE_OBSERVATION_RETENTION_MS - 1 : NOW - 2,
        index === 0 ? NOW - VERIFIED_PROCEDURE_OBSERVATION_RETENTION_MS - 1 : NOW - 2,
      );
    }

    await expect(recordRun('owner-cap-trigger', {}, NOW)).resolves.toMatchObject({
      status: 'recorded',
      prunedCount: 2,
    });
    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_verified_procedure_observations',
      )?.count,
    ).toBe(VERIFIED_PROCEDURE_MAX_OBSERVATIONS_PER_OWNER);
  });

  it('fails closed on corrupt manifests and stale privacy epochs', async () => {
    await recordRun('corrupt-run');
    getMemoryDb().runSync(
      "UPDATE memory_verified_procedure_observations SET evidence_manifest_json = '{}'",
    );
    await expect(readVerifiedProcedurePromotionState(scope(), NOW)).resolves.toEqual({
      status: 'unavailable',
      successfulRunCount: 0,
    });

    closeMemoryDb();
    expoSqlite.__resetExpoSqliteForTests();
    resetFactSchemaCacheForTests();
    ensureFactSchema();
    const authority = await issueAuthority('privacy-run');
    jest.spyOn(memoryPolicy, 'isMemoryPolicyEpochCurrent').mockReturnValue(false);
    await expect(recordVerifiedProcedureObservation(authority, NOW)).resolves.toEqual({
      status: 'rejected',
      code: 'memory_disabled',
    });
    await expect(recordVerifiedProcedureObservation(authority, NOW)).resolves.toEqual({
      status: 'rejected',
      code: 'invalid_authority',
    });
  });

  it('drops stale reads and participates in canonical memory reset', async () => {
    await recordRun('reset-run');
    const ownerBeforeReset = getLocalMemoryVaultOwnerId(getMemoryDb());
    jest.spyOn(memoryPolicy, 'isMemoryReadEpochCurrent').mockReturnValue(false);
    await expect(readVerifiedProcedurePromotionState(scope(), NOW)).resolves.toEqual({
      status: 'unavailable',
      successfulRunCount: 0,
    });
    jest.restoreAllMocks();

    clearStructuredMemory();
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_verified_procedure_observations',
      )?.count,
    ).toBe(0);
    expect(getLocalMemoryVaultOwnerId(getMemoryDb())).toBe(ownerBeforeReset);
  });
});
