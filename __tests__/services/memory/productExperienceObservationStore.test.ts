jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import * as memoryPolicy from '../../../src/services/memory/policy';
import {
  recordProductExperienceObservation,
  type ProductExperienceObservationInput,
} from '../../../src/services/memory/productExperienceObservationStore';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/sqlite-store';
import * as memorySchema from '../../../src/services/memory/schema';
import * as sqliteStore from '../../../src/services/memory/sqlite-store';
import * as Crypto from 'expo-crypto';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const DAY_MS = 24 * 60 * 60 * 1_000;
const RECORDED_AT = 200 * DAY_MS;

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

function observation(
  sourceRunId = 'run-1',
  overrides: Partial<ProductExperienceObservationInput> = {},
): ProductExperienceObservationInput {
  return {
    contractVersion: 1,
    memoryConversationId: 'memory-conversation-1',
    sourceThreadId: 'source-thread-1',
    sourceRunId,
    domainId: 'mobile.communication',
    environmentId: 'native-tools-v1',
    procedureId: 'contacts-search-to-sms-compose-v1',
    preconditionIds: ['contacts-permission-granted', 'sms-composer-available'],
    outcome: 'success',
    authority: 'verified',
    evidenceKind: 'runtime_verifier',
    evidenceId: `verification-${sourceRunId}`,
    observedAt: RECORDED_AT - DAY_MS,
    ...overrides,
  };
}

describe('product experience observation collection boundary', () => {
  it('rejects memory opt-out before hashing or touching schema storage', async () => {
    useSettingsStore.setState({ disableLongTermMemory: true } as never);
    const policySpy = jest.spyOn(memoryPolicy, 'canWriteLongTermMemory');
    const hashMock = jest.mocked(Crypto.digestStringAsync);
    hashMock.mockClear();
    const schemaSpy = jest.spyOn(memorySchema, 'ensureFactSchema');
    const databaseSpy = jest.spyOn(sqliteStore, 'getMemoryDb');

    await expect(recordProductExperienceObservation(observation(), RECORDED_AT)).resolves.toEqual({
      status: 'rejected',
      code: 'memory_disabled',
    });
    expect(policySpy).toHaveBeenCalled();
    expect(hashMock).not.toHaveBeenCalled();
    expect(schemaSpy).not.toHaveBeenCalled();
    expect(databaseSpy).not.toHaveBeenCalled();
  });

  it('stores only exact code identities and hashed private provenance', async () => {
    const input = observation();
    const result = await recordProductExperienceObservation(input, RECORDED_AT);

    expect(result).toEqual({
      status: 'recorded',
      observationId: expect.stringMatching(/^product_experience_[a-f0-9]{64}$/u),
      prunedCount: 0,
    });
    const row = getMemoryDb().getFirstSync<Record<string, unknown>>(
      'SELECT * FROM memory_product_experience_observations',
    );
    expect(row).toEqual(
      expect.objectContaining({
        memory_owner_id: expect.stringMatching(/^vault_owner_/u),
        memory_conversation_id_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        source_thread_id_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        source_run_id_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        domain_id: input.domainId,
        environment_id: input.environmentId,
        procedure_id: input.procedureId,
        precondition_ids_json: JSON.stringify(input.preconditionIds),
        precondition_ids_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        outcome: 'success',
        authority: 'verified',
        evidence_kind: 'runtime_verifier',
        evidence_id_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        contract_version: 1,
        observed_at: input.observedAt,
        created_at: RECORDED_AT,
      }),
    );
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(input.memoryConversationId);
    expect(serialized).not.toContain(input.sourceThreadId);
    expect(serialized).not.toContain(input.sourceRunId);
    expect(serialized).not.toContain(input.evidenceId);
    expect(Object.keys(row ?? {})).not.toEqual(
      expect.arrayContaining(['goal', 'arguments', 'result', 'summary', 'user_content']),
    );
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_facts',
      )?.count,
    ).toBe(0);
  });

  it('is idempotent but rejects conflicting evidence from the same exact run scope', async () => {
    const input = observation();
    const first = await recordProductExperienceObservation(input, RECORDED_AT);

    await expect(recordProductExperienceObservation(input, RECORDED_AT + 1)).resolves.toEqual({
      status: 'unchanged',
      observationId:
        first.status === 'recorded' || first.status === 'unchanged' ? first.observationId : '',
      prunedCount: 0,
    });
    await expect(
      recordProductExperienceObservation(
        observation('run-1', { outcome: 'failure' }),
        RECORDED_AT,
      ),
    ).resolves.toEqual({ status: 'rejected', code: 'conflicting_run_evidence' });
    await expect(
      recordProductExperienceObservation(
        observation('run-1', { evidenceId: 'different-verification' }),
        RECORDED_AT,
      ),
    ).resolves.toEqual({ status: 'rejected', code: 'conflicting_run_evidence' });
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_product_experience_observations',
      )?.count,
    ).toBe(1);
  });

  it('rejects inferred authority, free-text identities, malformed shape, and invalid timelines', async () => {
    const invalidInputs: unknown[] = [
      { ...observation(), authority: 'assistant_inferred' },
      { ...observation(), procedureId: 'send a message to the person' },
      {
        ...observation(),
        preconditionIds: ['sms-composer-available', 'contacts-permission-granted'],
      },
      { ...observation(), authority: 'verified', evidenceKind: 'tool_result' },
      { ...observation(), unexpectedContent: 'private transcript text' },
      { ...observation(), observedAt: RECORDED_AT + 1 },
      { ...observation(), observedAt: RECORDED_AT - 181 * DAY_MS },
    ];

    for (const invalidInput of invalidInputs) {
      await expect(
        recordProductExperienceObservation(
          invalidInput as ProductExperienceObservationInput,
          RECORDED_AT,
        ),
      ).resolves.toEqual({ status: 'rejected', code: 'invalid_input' });
    }
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_product_experience_observations',
      )?.count,
    ).toBe(0);
  });

  it('keeps owner, conversation, thread, environment, and procedure boundaries distinct', async () => {
    const variants = [
      observation('run-1'),
      observation('run-2', { memoryConversationId: 'memory-conversation-2' }),
      observation('run-3', { sourceThreadId: 'source-thread-2' }),
      observation('run-4', { environmentId: 'native-tools-v2' }),
      observation('run-5', { procedureId: 'contacts-search-to-email-compose-v1' }),
    ];
    let firstObservationId = '';
    for (const input of variants) {
      const result = await recordProductExperienceObservation(input, RECORDED_AT);
      expect(result).toMatchObject({ status: 'recorded' });
      if (!firstObservationId && result.status === 'recorded') {
        firstObservationId = result.observationId;
      }
    }
    const rows = getMemoryDb().getAllSync<{ id: string }>(
      'SELECT id FROM memory_product_experience_observations',
    );
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((row) => row.id)).size).toBe(5);

    const ownerId = getLocalMemoryVaultOwnerId(getMemoryDb());
    getMemoryDb().runSync(
      "UPDATE memory_product_experience_observations SET memory_owner_id = 'vault_owner_other' WHERE id = ?",
      firstObservationId,
    );
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_product_experience_observations WHERE memory_owner_id = ?',
        ownerId,
      )?.count,
    ).toBe(4);
    await expect(
      recordProductExperienceObservation(observation('run-1'), RECORDED_AT),
    ).resolves.toEqual({ status: 'failed', code: 'storage_error' });
  });

  it('keeps only the newest bounded evidence window for one exact procedure scope', async () => {
    let finalResult: Awaited<ReturnType<typeof recordProductExperienceObservation>> | undefined;
    for (let index = 0; index < 65; index += 1) {
      finalResult = await recordProductExperienceObservation(
        observation(`bounded-run-${index}`, {
          evidenceId: `bounded-verification-${index}`,
          observedAt: RECORDED_AT - 65 + index,
        }),
        RECORDED_AT,
      );
      expect(finalResult.status).toBe('recorded');
    }

    expect(finalResult).toMatchObject({ status: 'recorded', prunedCount: 1 });
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_product_experience_observations',
      )?.count,
    ).toBe(64);
  });

  it('enforces retention and exact-scope and owner storage caps on every accepted write', async () => {
    const db = getMemoryDb();
    const ownerId = getLocalMemoryVaultOwnerId(db);
    const fixedHash = (character: string) => character.repeat(64);
    for (let index = 0; index < 513; index += 1) {
      const hex = index.toString(16).padStart(64, '0');
      db.runSync(
        `INSERT INTO memory_product_experience_observations(
           id, memory_owner_id, memory_conversation_id_hash, source_thread_id_hash,
           source_run_id_hash, domain_id, environment_id, procedure_id,
           precondition_ids_json, precondition_ids_hash, outcome, authority,
           evidence_kind, evidence_id_hash, contract_version, observed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 'success', 'verified',
                   'runtime_verifier', ?, 1, ?, ?)`,
        `product_experience_${hex}`,
        ownerId,
        fixedHash('a'),
        fixedHash('b'),
        hex,
        'seed-domain',
        'seed-environment',
        `seed-procedure-${index}`,
        fixedHash('c'),
        fixedHash('d'),
        index === 0 ? RECORDED_AT - 181 * DAY_MS : RECORDED_AT - 2,
        index === 0 ? RECORDED_AT - 181 * DAY_MS : RECORDED_AT - 2,
      );
    }

    const result = await recordProductExperienceObservation(
      observation('cap-trigger', { observedAt: RECORDED_AT }),
      RECORDED_AT,
    );
    expect(result).toMatchObject({ status: 'recorded' });
    expect(result.status === 'recorded' ? result.prunedCount : 0).toBe(2);
    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_product_experience_observations',
      )?.count,
    ).toBe(512);
  });
});
