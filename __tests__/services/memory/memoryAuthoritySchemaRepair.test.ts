jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { recordThreadLocalEpisode } from '../../../src/services/memory/episodes/mutations';
import { EPISODE_RETRIEVAL_INDEX_VERSION } from '../../../src/services/memory/episodes/retrievalIndex';
import {
  captureMemoryAuthoritySnapshot,
  isMemoryProjectionSnapshotCurrent,
  isMemoryProjectionSnapshotDurablyCurrent,
  isRestrictiveMemoryAuthoritySnapshotCurrent,
  isRestrictiveMemoryAuthoritySnapshotDurablyCurrent,
} from '../../../src/services/memory/memoryAuthority';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { codeOwnedClosedTurnEpisodeFields } from '../../helpers/memoryRetirementTestFixtures';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function requireAuthoritySnapshot() {
  const snapshot = captureMemoryAuthoritySnapshot();
  if (!snapshot) throw new Error('expected memory authority snapshot');
  return snapshot;
}

function expectProjectionStaleOnly(snapshot: ReturnType<typeof requireAuthoritySnapshot>): void {
  expect(isMemoryProjectionSnapshotCurrent(snapshot)).toBe(false);
  expect(isMemoryProjectionSnapshotDurablyCurrent(snapshot)).toBe(false);
  expect(isRestrictiveMemoryAuthoritySnapshotCurrent(snapshot)).toBe(true);
  expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(snapshot)).toBe(true);
}

function expectAuthorityCurrent(snapshot: ReturnType<typeof requireAuthoritySnapshot>): void {
  expect(isMemoryProjectionSnapshotCurrent(snapshot)).toBe(true);
  expect(isMemoryProjectionSnapshotDurablyCurrent(snapshot)).toBe(true);
  expect(isRestrictiveMemoryAuthoritySnapshotCurrent(snapshot)).toBe(true);
  expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(snapshot)).toBe(true);
}

function expectDurableRevisionsUnchanged(
  snapshot: ReturnType<typeof requireAuthoritySnapshot>,
): void {
  expect(
    getMemoryDb().getFirstSync(
      `SELECT restrictive_authority_revision, projection_revision
         FROM memory_vault_identity
        WHERE singleton = 1`,
    ),
  ).toEqual({
    restrictive_authority_revision: snapshot.restrictiveRevision.value,
    projection_revision: snapshot.projectionRevision.value,
  });
}

function seedIndexedEpisode(): string {
  const episode = recordThreadLocalEpisode({
    conversationId: 'conversation-repair',
    threadId: 'thread-repair',
    taskId: null,
    summary: '旅行の計画 تم تثبيتها',
    entities: ['東京', 'القاهرة'],
    toolNames: ['calendar.lookup'],
    ...codeOwnedClosedTurnEpisodeFields({
      sourceUserMessageId: 'message-repair-user',
      sourceAssistantMessageId: 'message-repair-assistant',
      userContent: '旅行の計画',
      assistantContent: 'تم تثبيتها',
    }),
    now: 100,
  });
  if (!episode) throw new Error('expected indexed episode');
  return episode.id;
}

function seedFactTermWithoutStats(): void {
  const db = getMemoryDb();
  db.runSync(
    `INSERT INTO memory_fact_terms(fact_id, unit, source_run_id, memory_kind, weight)
     VALUES ('fact-term-repair', 'حجز', NULL, 'semantic_fact', 1.5)`,
  );
  db.runSync('DELETE FROM memory_fact_term_stats');
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  jest.restoreAllMocks();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

describe('memory authority for durable schema repairs', () => {
  it('advances projection freshness when a populated episode index is rebuilt and not on replay', () => {
    const episodeId = seedIndexedEpisode();
    const db = getMemoryDb();
    db.runSync(
      'UPDATE memory_episode_retrieval_index_meta SET version = ? WHERE singleton = 1',
      EPISODE_RETRIEVAL_INDEX_VERSION + 1,
    );
    const beforeRepair = requireAuthoritySnapshot();

    resetFactSchemaCacheForTests();
    ensureFactSchema();

    expectProjectionStaleOnly(beforeRepair);
    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_episode_terms WHERE episode_id = ?',
        episodeId,
      )?.count,
    ).toBeGreaterThan(0);

    const afterRepair = requireAuthoritySnapshot();
    resetFactSchemaCacheForTests();
    ensureFactSchema();
    expectAuthorityCurrent(afterRepair);
  });

  it('rolls an episode-index repair and its durable revision back together', () => {
    const episodeId = seedIndexedEpisode();
    const db = getMemoryDb();
    const termsBefore = db.getFirstSync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM memory_episode_terms WHERE episode_id = ?',
      episodeId,
    )?.count;
    db.runSync(
      'UPDATE memory_episode_retrieval_index_meta SET version = ? WHERE singleton = 1',
      EPISODE_RETRIEVAL_INDEX_VERSION + 1,
    );
    const beforeRepair = requireAuthoritySnapshot();
    const execSync = db.execSync.bind(db);
    jest.spyOn(db, 'execSync').mockImplementation((source: string) => {
      if (source.trim() === 'COMMIT') throw new Error('forced_episode_index_commit_failure');
      execSync(source);
    });

    resetFactSchemaCacheForTests();
    expect(() => ensureFactSchema()).toThrow('forced_episode_index_commit_failure');

    expect(isMemoryProjectionSnapshotCurrent(beforeRepair)).toBe(true);
    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(beforeRepair)).toBe(true);
    expectDurableRevisionsUnchanged(beforeRepair);
    expect(
      db.getFirstSync<{ version: number }>(
        'SELECT version FROM memory_episode_retrieval_index_meta WHERE singleton = 1',
      )?.version,
    ).toBe(EPISODE_RETRIEVAL_INDEX_VERSION + 1);
    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_episode_terms WHERE episode_id = ?',
        episodeId,
      )?.count,
    ).toBe(termsBefore);
  });

  it('advances projection freshness for a real fact-stat repair and not on replay', () => {
    seedFactTermWithoutStats();
    const beforeRepair = requireAuthoritySnapshot();

    resetFactSchemaCacheForTests();
    ensureFactSchema();

    expectProjectionStaleOnly(beforeRepair);
    expect(
      getMemoryDb().getFirstSync(
        `SELECT fact_count, total_weight
           FROM memory_fact_term_stats
          WHERE unit = 'حجز' AND memory_kind = 'semantic_fact'`,
      ),
    ).toEqual({ fact_count: 1, total_weight: 1.5 });

    const afterRepair = requireAuthoritySnapshot();
    resetFactSchemaCacheForTests();
    ensureFactSchema();
    expectAuthorityCurrent(afterRepair);
  });

  it('rolls a fact-stat repair and its durable revision back together', () => {
    seedFactTermWithoutStats();
    const db = getMemoryDb();
    const beforeRepair = requireAuthoritySnapshot();
    const execSync = db.execSync.bind(db);
    jest.spyOn(db, 'execSync').mockImplementation((source: string) => {
      if (source.trim() === 'COMMIT') {
        const statsCount =
          db.getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_fact_term_stats')
            ?.count ?? 0;
        const projectionRevision = db.getFirstSync<{ projection_revision: number }>(
          'SELECT projection_revision FROM memory_vault_identity WHERE singleton = 1',
        )?.projection_revision;
        if (statsCount > 0 && projectionRevision === beforeRepair.projectionRevision.value + 1) {
          throw new Error('forced_fact_stats_commit_failure');
        }
      }
      execSync(source);
    });

    resetFactSchemaCacheForTests();
    expect(() => ensureFactSchema()).toThrow('forced_fact_stats_commit_failure');

    expect(isMemoryProjectionSnapshotCurrent(beforeRepair)).toBe(true);
    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(beforeRepair)).toBe(true);
    expectDurableRevisionsUnchanged(beforeRepair);
    expect(
      db.getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_fact_term_stats')
        ?.count,
    ).toBe(0);
  });
});
