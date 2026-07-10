jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import * as Crypto from 'expo-crypto';
import {
  buildMemoryRetrievalQueryFingerprint,
  buildMemoryRetrievalScopeHash,
  readRecentMemoryRetrievalEvents,
  recordMemoryRetrievalEvent,
} from '../../../src/services/memory/retrievalLog';
import {
  MEMORY_RETRIEVAL_EVENT_RETENTION_LIMIT,
  MEMORY_RETRIEVAL_SELECTED_ID_LIMIT,
  type RecordMemoryRetrievalEventInput,
} from '../../../src/services/memory/retrievalEventTypes';
import {
  clearStructuredMemory,
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/sqlite-store';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

async function makeEventInput(
  overrides: Partial<RecordMemoryRetrievalEventInput> = {},
): Promise<RecordMemoryRetrievalEventInput> {
  const queryFingerprint =
    overrides.queryFingerprint ??
    (await buildMemoryRetrievalQueryFingerprint('synthetic retrieval query'));
  const scope = overrides.scope ?? {
    memoryConversationIdHash: await buildMemoryRetrievalScopeHash(
      'memory_conversation',
      'memory-conv-1',
    ),
    sourceThreadIdHash: await buildMemoryRetrievalScopeHash('source_thread', 'thread-1'),
    taskScopePresent: true,
  };
  return {
    operation: 'prompt_assembly',
    mode: 'query',
    outcome: 'completed',
    queryFingerprint,
    scope,
    counts: {
      candidateFactCount: 8,
      selectedFactCount: 2,
      selectedFactIds: ['fact-1', 'fact-2'],
      candidateEpisodeCount: 4,
      selectedEpisodeCount: 1,
      selectedEpisodeIds: ['episode-1'],
    },
    timings: {
      planMs: 1,
      factRecallMs: 2,
      episodeRecallMs: 3,
      candidateFetchMs: 1,
      scoreMs: 1,
      selectorMs: 0,
      totalMs: 6,
    },
    selector: { mode: 'deterministic', outcome: 'not_requested' },
    barrier: { outcome: 'completed', waitMs: 10, queueAgeMs: 25 },
    createdAt: 100,
    ...overrides,
  };
}

describe('structured memory retrieval event store', () => {
  it('uses platform SHA-256 and rejects oversized input before hashing', async () => {
    await expect(buildMemoryRetrievalQueryFingerprint('abc')).resolves.toEqual({
      hashAlgorithm: 'sha256',
      hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      length: 3,
      unitCount: 1,
    });

    const digest = jest.mocked(Crypto.digestStringAsync);
    const callsBeforeOversizedInput = digest.mock.calls.length;
    await expect(buildMemoryRetrievalQueryFingerprint('x'.repeat(20_001))).rejects.toThrow(
      'fingerprint input bound',
    );
    expect(digest).toHaveBeenCalledTimes(callsBeforeOversizedInput);
  });

  it('domain-separates locally correlatable scope hashes', async () => {
    const memoryHash = await buildMemoryRetrievalScopeHash(
      'memory_conversation',
      'shared-structural-id',
    );
    const threadHash = await buildMemoryRetrievalScopeHash('source_thread', 'shared-structural-id');

    expect(memoryHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(threadHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(memoryHash).not.toBe(threadHash);
  });

  it('stores only closed structured evidence and no raw query or scope prose', async () => {
    const rawSentinel = 'PRIVATE RAW RETRIEVAL QUERY SENTINEL';
    const input = await makeEventInput({
      queryFingerprint: await buildMemoryRetrievalQueryFingerprint(rawSentinel),
    });

    await expect(recordMemoryRetrievalEvent(input)).resolves.toMatchObject({
      status: 'recorded',
    });
    const entries = readRecentMemoryRetrievalEvents();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      operation: 'prompt_assembly',
      mode: 'query',
      outcome: 'completed',
      queryFingerprint: {
        hashAlgorithm: 'sha256',
        length: rawSentinel.length,
        unitCount: 5,
      },
      counts: {
        candidateFactCount: 8,
        selectedFactCount: 2,
        selectedFactIds: ['fact-1', 'fact-2'],
        candidateEpisodeCount: 4,
        selectedEpisodeCount: 1,
        selectedEpisodeIds: ['episode-1'],
      },
      selector: { mode: 'deterministic', outcome: 'not_requested' },
      barrier: null,
      barrier: { outcome: 'completed', waitMs: 10, queueAgeMs: 25 },
    });

    const columns = getMemoryDb()
      .getAllSync<{ name: string }>('PRAGMA table_info(memory_retrieval_events)')
      .map((column) => column.name);
    expect(columns).not.toEqual(
      expect.arrayContaining(['query', 'task_id', 'memory_conversation_id', 'source_thread_id']),
    );
    const rawRows = getMemoryDb().getAllSync<Record<string, unknown>>(
      'SELECT * FROM memory_retrieval_events',
    );
    expect(JSON.stringify(rawRows)).not.toContain(rawSentinel);
    expect(JSON.stringify(entries)).not.toContain(rawSentinel);
    expect(entries[0]).not.toHaveProperty('query');
  });

  it('destructively removes the legacy raw-query table without copying it', () => {
    const db = getMemoryDb();
    db.execSync(`
      DROP TABLE memory_retrieval_events;
      CREATE TABLE memory_retrieval_log (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO memory_retrieval_log(id, query, created_at)
      VALUES ('legacy-1', 'PRIVATE LEGACY QUERY SENTINEL', 1);
    `);
    resetFactSchemaCacheForTests();

    ensureFactSchema();

    expect(
      db.getFirstSync(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_retrieval_log'",
      ),
    ).toBeNull();
    expect(readRecentMemoryRetrievalEvents()).toEqual([]);
    expect(JSON.stringify(db.getAllSync('SELECT * FROM memory_retrieval_events'))).not.toContain(
      'PRIVATE LEGACY QUERY SENTINEL',
    );
  });

  it('rejects malformed, open-ended, and out-of-bound fields without writing', async () => {
    const base = await makeEventInput();
    const disabledBase: RecordMemoryRetrievalEventInput = {
      ...base,
      mode: 'disabled',
      outcome: 'disabled',
      counts: {
        candidateFactCount: 0,
        selectedFactCount: 0,
        selectedFactIds: [],
        candidateEpisodeCount: 0,
        selectedEpisodeCount: 0,
        selectedEpisodeIds: [],
      },
      timings: {
        planMs: 0,
        factRecallMs: 0,
        episodeRecallMs: 0,
        candidateFetchMs: 0,
        scoreMs: 0,
        selectorMs: 0,
        totalMs: 0,
      },
      selector: { mode: 'deterministic', outcome: 'not_requested' },
    };
    const tooManyIds = Array.from(
      { length: MEMORY_RETRIEVAL_SELECTED_ID_LIMIT + 1 },
      (_, index) => `fact-${index}`,
    );
    const invalidCases: Array<{
      input: RecordMemoryRetrievalEventInput;
      code: string;
    }> = [
      { input: { ...base, operation: 'private_operation' as never }, code: 'invalid_operation' },
      { input: { ...base, mode: 'private_mode' as never }, code: 'invalid_mode' },
      { input: { ...base, outcome: 'private_outcome' as never }, code: 'invalid_outcome' },
      {
        input: {
          ...base,
          queryFingerprint: { ...base.queryFingerprint, hash: 'not-a-sha256' },
        },
        code: 'invalid_query_fingerprint',
      },
      {
        input: {
          ...base,
          scope: { ...base.scope, sourceThreadIdHash: 'raw-private-scope-id' },
        },
        code: 'invalid_scope',
      },
      {
        input: {
          ...base,
          counts: { ...base.counts, selectedFactCount: 9 },
        },
        code: 'invalid_counts',
      },
      {
        input: {
          ...base,
          counts: {
            ...base.counts,
            candidateFactCount: tooManyIds.length,
            selectedFactCount: tooManyIds.length,
            selectedFactIds: tooManyIds,
          },
        },
        code: 'invalid_selected_ids',
      },
      {
        input: { ...base, timings: { ...base.timings, totalMs: 600_001 } },
        code: 'invalid_timings',
      },
      {
        input: { ...base, selector: { mode: 'deterministic', outcome: 'applied' } },
        code: 'invalid_selector',
      },
      {
        input: {
          ...base,
          barrier: { outcome: 'completed', waitMs: 0, queueAgeMs: 2_678_400_001 },
        },
        code: 'invalid_barrier',
      },
      {
        input: {
          ...base,
          barrier: { outcome: 'opt_out' as never, waitMs: 0, queueAgeMs: null },
        },
        code: 'invalid_barrier',
      },
      {
        input: { ...base, mode: 'disabled' },
        code: 'invalid_state_combination',
      },
      {
        input: { ...base, outcome: 'disabled' },
        code: 'invalid_state_combination',
      },
      {
        input: { ...disabledBase, timings: { ...disabledBase.timings, totalMs: 1 } },
        code: 'invalid_state_combination',
      },
      {
        input: {
          ...disabledBase,
          counts: { ...disabledBase.counts, candidateFactCount: 1 },
        },
        code: 'invalid_state_combination',
      },
      {
        input: {
          ...disabledBase,
          counts: { ...disabledBase.counts, selectedFactIds: ['fact-disabled'] },
        },
        code: 'invalid_state_combination',
      },
      {
        input: {
          ...disabledBase,
          selector: { mode: 'semantic', outcome: 'not_requested' },
        },
        code: 'invalid_state_combination',
      },
      {
        input: {
          ...disabledBase,
          barrier: { outcome: 'no_job', waitMs: 0, queueAgeMs: null },
        },
        code: 'invalid_state_combination',
      },
      { input: { ...base, createdAt: -1 }, code: 'invalid_timestamp' },
    ];

    for (const invalidCase of invalidCases) {
      await expect(recordMemoryRetrievalEvent(invalidCase.input)).resolves.toEqual({
        status: 'rejected',
        code: invalidCase.code,
      });
    }
    expect(readRecentMemoryRetrievalEvents()).toEqual([]);
  });

  it('retains the newest bounded rows and filters them in deterministic order', async () => {
    const queryFingerprint = await buildMemoryRetrievalQueryFingerprint('retention query');
    const threadAHash = await buildMemoryRetrievalScopeHash('source_thread', 'thread-a');
    const threadBHash = await buildMemoryRetrievalScopeHash('source_thread', 'thread-b');
    for (let index = 0; index <= MEMORY_RETRIEVAL_EVENT_RETENTION_LIMIT; index += 1) {
      const input = await makeEventInput({
        queryFingerprint,
        operation: index % 2 === 0 ? 'explicit_search' : 'prompt_assembly',
        scope: {
          memoryConversationIdHash: null,
          sourceThreadIdHash: index % 3 === 0 ? threadAHash : threadBHash,
          taskScopePresent: false,
        },
        createdAt: index,
      });
      await expect(recordMemoryRetrievalEvent(input)).resolves.toMatchObject({
        status: 'recorded',
      });
    }

    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_retrieval_events',
      )?.count,
    ).toBe(MEMORY_RETRIEVAL_EVENT_RETENTION_LIMIT);
    const entries = readRecentMemoryRetrievalEvents({
      sourceThreadIdHash: threadAHash ?? undefined,
      operation: 'explicit_search',
      limit: 3,
    });
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.createdAt)).toEqual(
      [...entries.map((entry) => entry.createdAt)].sort((left, right) => right - left),
    );
    expect(entries.every((entry) => entry.operation === 'explicit_search')).toBe(true);
    expect(entries.every((entry) => entry.scope.sourceThreadIdHash === threadAHash)).toBe(true);
  });

  it('reports storage failure without throwing or manufacturing success', async () => {
    readRecentMemoryRetrievalEvents();
    getMemoryDb().execSync(`
      CREATE TRIGGER fail_retrieval_event_insert
      BEFORE INSERT ON memory_retrieval_events
      BEGIN
        SELECT RAISE(FAIL, 'forced retrieval logging failure');
      END;
    `);

    await expect(recordMemoryRetrievalEvent(await makeEventInput())).resolves.toEqual({
      status: 'failed',
      code: 'storage_error',
    });
    expect(readRecentMemoryRetrievalEvents()).toEqual([]);
  });

  it('clears structured retrieval events with the rest of durable memory', async () => {
    await expect(recordMemoryRetrievalEvent(await makeEventInput())).resolves.toMatchObject({
      status: 'recorded',
    });

    clearStructuredMemory();

    expect(readRecentMemoryRetrievalEvents()).toEqual([]);
  });
});
