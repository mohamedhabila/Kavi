jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { Platform } from 'react-native';
import * as memoryDatabase from '../../../src/services/memory/database';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import {
  recordProductExperienceObservation,
  type ProductExperienceOutcome,
} from '../../../src/services/memory/productExperienceObservationStore';
import {
  PRODUCT_EXPERIENCE_READ_ROW_LIMIT,
  readVerifiedToolEffectExperienceLearnings,
} from '../../../src/services/memory/verifiedToolEffectExperienceLearning';
import {
  resolveVerifiedToolEffectExperienceScopes,
  type VerifiedToolEffectExperienceScope,
} from '../../../src/services/memory/verifiedToolEffectExperience';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import * as memorySchema from '../../../src/services/memory/schema';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const mutablePlatform = Platform as unknown as { OS: string };
const NOW = 2_000_000;

async function requireScope(toolName: string): Promise<VerifiedToolEffectExperienceScope> {
  const [scope] = await resolveVerifiedToolEffectExperienceScopes(toolName);
  if (!scope) throw new Error(`missing test scope for ${toolName}`);
  return scope;
}

async function seedOutcomes(params: {
  toolName: string;
  outcomes: ReadonlyArray<ProductExperienceOutcome>;
  runPrefix?: string;
  preconditionIds?: ReadonlyArray<string>;
}): Promise<void> {
  const scope = await requireScope(params.toolName);
  for (const [index, outcome] of params.outcomes.entries()) {
    const runId = `${params.runPrefix ?? params.toolName}-private-run-${index}`;
    const authority = outcome === 'success' ? 'verified' : 'tool_observed';
    const result = await recordProductExperienceObservation(
      {
        contractVersion: 1,
        memoryConversationId: 'private-memory-conversation',
        sourceThreadId: 'private-source-thread',
        sourceRunId: runId,
        domainId: scope.domainId,
        environmentId: scope.environmentId,
        procedureId: scope.procedureId,
        preconditionIds: params.preconditionIds ?? scope.preconditionIds,
        outcome,
        authority,
        evidenceKind: authority === 'verified' ? 'runtime_verifier' : 'tool_result',
        evidenceId: `${runId}-private-evidence`,
        observedAt: NOW - 100 + index,
      },
      NOW,
    );
    expect(result).toMatchObject({ status: 'recorded' });
  }
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  mutablePlatform.OS = 'ios';
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  closeMemoryDb();
  jest.restoreAllMocks();
});

describe('verified tool effect experience learning reader', () => {
  it('reuses corroborated successes and failures only in their exact current scopes', async () => {
    await seedOutcomes({
      toolName: 'calendar_create_event',
      outcomes: ['success', 'success', 'success'],
    });
    await seedOutcomes({
      toolName: 'screen_record',
      outcomes: ['failure', 'failure', 'failure'],
    });

    const read = await readVerifiedToolEffectExperienceLearnings([
      'calendar_create_event',
      'screen_record',
    ]);

    expect(read.readEpoch).toEqual(expect.any(Number));
    expect(read.learnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: expect.objectContaining({
            toolName: 'calendar_create_event',
            platform: 'ios',
          }),
          record: expect.objectContaining({ recommendation: 'prefer' }),
        }),
        expect.objectContaining({
          scope: expect.objectContaining({ toolName: 'screen_record', platform: 'ios' }),
          record: expect.objectContaining({ recommendation: 'avoid' }),
        }),
      ]),
    );
    expect(
      await readVerifiedToolEffectExperienceLearnings(['calendar_update_event']),
    ).toEqual({ learnings: [] });
  });

  it('does not promote insufficient or mixed direct evidence', async () => {
    await seedOutcomes({
      toolName: 'calendar_create_event',
      outcomes: ['success', 'success'],
    });
    await expect(
      readVerifiedToolEffectExperienceLearnings(['calendar_create_event']),
    ).resolves.toEqual({ learnings: [] });

    await seedOutcomes({
      toolName: 'calendar_create_event',
      runPrefix: 'mixed-failure',
      outcomes: ['failure', 'failure', 'failure'],
    });
    await expect(
      readVerifiedToolEffectExperienceLearnings(['calendar_create_event']),
    ).resolves.toEqual({ learnings: [] });
  });

  it('does not cross the exact mobile platform environment', async () => {
    await seedOutcomes({
      toolName: 'calendar_create_event',
      outcomes: ['success', 'success', 'success'],
    });
    mutablePlatform.OS = 'android';

    await expect(
      readVerifiedToolEffectExperienceLearnings(['calendar_create_event']),
    ).resolves.toEqual({ learnings: [] });
  });

  it('keeps unrelated newer observations from starving exact-scope evidence', async () => {
    await seedOutcomes({
      toolName: 'calendar_create_event',
      outcomes: ['success', 'success', 'success'],
    });
    const db = getMemoryDb();
    const ownerId = getLocalMemoryVaultOwnerId(db);
    for (let index = 0; index < PRODUCT_EXPERIENCE_READ_ROW_LIMIT; index += 1) {
      const hash = (index + 1_000).toString(16).padStart(64, '0');
      db.runSync(
        `INSERT INTO memory_product_experience_observations(
           id, memory_owner_id, memory_conversation_id_hash, source_thread_id_hash,
           source_run_id_hash, domain_id, environment_id, procedure_id,
           precondition_ids_json, precondition_ids_hash, outcome, authority,
           evidence_kind, evidence_id_hash, contract_version, observed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 'success', 'verified',
                   'runtime_verifier', ?, 1, ?, ?)`,
        `product_experience_${hash}`,
        ownerId,
        'a'.repeat(64),
        'b'.repeat(64),
        hash,
        'unrelated.effect',
        'unrelated.newer.environment',
        `unrelated-procedure-${index}`,
        'c'.repeat(64),
        'd'.repeat(64),
        NOW + index,
        NOW + index,
      );
    }

    const read = await readVerifiedToolEffectExperienceLearnings(['calendar_create_event']);

    expect(read.learnings).toHaveLength(1);
    expect(read.learnings[0]?.record.recommendation).toBe('prefer');
  });

  it('keeps only unique recordable outcome domains for one tool contract', async () => {
    const memoryBlockScopes = await resolveVerifiedToolEffectExperienceScopes('memory_block');
    const emailScopes = await resolveVerifiedToolEffectExperienceScopes('email_compose');

    expect(memoryBlockScopes.map((scope) => scope.domainId)).toEqual([
      'mobile-assistant.effect.memory.write',
    ]);
    expect(new Set(memoryBlockScopes.map((scope) => JSON.stringify(scope))).size).toBe(
      memoryBlockScopes.length,
    );
    expect(emailScopes.map((scope) => scope.domainId)).toEqual([
      'mobile-assistant.effect.communication.send',
    ]);
    expect(emailScopes.map((scope) => scope.domainId).join('\n')).not.toContain(
      'communication.draft_',
    );
  });

  it('does not infer applicability across a different recorded precondition set', async () => {
    await seedOutcomes({
      toolName: 'calendar_create_event',
      outcomes: ['success', 'success', 'success'],
      preconditionIds: ['calendar-permission-observed'],
    });

    await expect(
      readVerifiedToolEffectExperienceLearnings(['calendar_create_event']),
    ).resolves.toEqual({ learnings: [] });
  });

  it('does not initialize or read SQLite when long-term memory is already disabled', async () => {
    closeMemoryDb();
    expoSqlite.__resetExpoSqliteForTests();
    resetFactSchemaCacheForTests();
    useSettingsStore.setState({ disableLongTermMemory: true } as never);
    const schemaSpy = jest.spyOn(memorySchema, 'ensureFactSchema');
    const databaseSpy = jest.spyOn(memoryDatabase, 'getMemoryDb');

    await expect(
      readVerifiedToolEffectExperienceLearnings(['calendar_create_event']),
    ).resolves.toEqual({ learnings: [] });
    expect(schemaSpy).not.toHaveBeenCalled();
    expect(databaseSpy).not.toHaveBeenCalled();
  });

  it('drops a read when opt-out occurs after SQLite returns but before artifact use', async () => {
    await seedOutcomes({
      toolName: 'calendar_create_event',
      outcomes: ['success', 'success', 'success'],
    });
    const db = getMemoryDb();
    const originalGetAllSync = db.getAllSync.bind(db);
    jest.spyOn(db, 'getAllSync').mockImplementation(((sql: string, ...args: unknown[]) => {
      const rows = originalGetAllSync(sql, ...args);
      if (sql.includes('FROM memory_product_experience_observations')) {
        useSettingsStore.setState({ disableLongTermMemory: true } as never);
      }
      return rows;
    }) as typeof db.getAllSync);

    await expect(
      readVerifiedToolEffectExperienceLearnings(['calendar_create_event']),
    ).resolves.toEqual({ learnings: [] });
  });

  it('reads a bounded column allowlist and never surfaces private provenance or payload text', async () => {
    await seedOutcomes({
      toolName: 'calendar_create_event',
      outcomes: ['success', 'success', 'success'],
    });
    const db = getMemoryDb();
    const readSpy = jest.spyOn(db, 'getAllSync');
    const read = await readVerifiedToolEffectExperienceLearnings(['calendar_create_event']);
    const observationRead = readSpy.mock.calls.find(([sql]) =>
      String(sql).includes('FROM memory_product_experience_observations'),
    );
    const serializedRead = JSON.stringify(read);

    expect(observationRead?.[0]).toContain(
      'source_run_id_hash, domain_id, environment_id, procedure_id',
    );
    expect(observationRead?.[0]).not.toMatch(/arguments|result_text|user|assistant|summary/iu);
    expect(observationRead?.[0]).not.toMatch(
      /evidence_id_hash|memory_conversation_id_hash|source_thread_id_hash|created_at/iu,
    );
    expect(observationRead?.at(-1)).toBe(PRODUCT_EXPERIENCE_READ_ROW_LIMIT);
    expect(serializedRead).not.toContain('private-memory-conversation');
    expect(serializedRead).not.toContain('private-source-thread');
    expect(serializedRead).not.toContain('private-run');
    expect(serializedRead).not.toContain('private-evidence');
  });
});
