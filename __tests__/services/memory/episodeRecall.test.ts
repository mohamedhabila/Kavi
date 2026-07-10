// ---------------------------------------------------------------------------
// Tests — Episode recall (indexed relevance retrieval)
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { recordThreadLocalEpisode } from '../../../src/services/memory/episodes/mutations';
import { ensureEpisodeAccessPolicySchema } from '../../../src/services/memory/episodes/accessPolicySchema';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import { bindEpisodeAccessPolicy } from '../../../src/services/memory/episodes/accessPolicyStore';
import {
  EPISODE_PRESENTATION_MAX,
  EPISODE_QUERY_CANDIDATE_MAX,
  EPISODE_QUERY_CANDIDATE_MIN,
  EPISODE_RECALL_LOCAL_P95_BUDGET_MS,
  recallEpisodesForQuery,
  recallRecentEpisodes,
  recallScopedEpisodesForQuery,
  type RecallEpisodesTiming,
} from '../../../src/services/memory/episodeRecall';
import { DEFAULT_MEMORY_PERSONA_ID } from '../../../src/services/memory/memoryScopeIdentity';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/sqlite-store';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureEpisodeAccessPolicySchema(getMemoryDb(), 1);
});

function makeEpisode(overrides: Partial<Parameters<typeof recordThreadLocalEpisode>[0]> = {}) {
  const episode = recordThreadLocalEpisode({
    conversationId: 'conv-1',
    threadId: 'conv-1',
    summary: 'Test episode',
    startedAt: Date.now(),
    endedAt: Date.now(),
    ...overrides,
  });
  if (!episode) throw new Error('recordThreadLocalEpisode returned null');
  return episode;
}

function makeCompleteEpisode(
  suffix: string,
  overrides: Partial<Parameters<typeof recordThreadLocalEpisode>[0]> = {},
) {
  return makeEpisode({
    conversationId: 'root-conversation',
    threadId: `thread-${suffix}`,
    summary: `release continuity ${suffix}`,
    messageIds: [`message-${suffix}-start`, `message-${suffix}-end`],
    sourceStartMessageId: `message-${suffix}-start`,
    sourceEndMessageId: `message-${suffix}-end`,
    startedAt: 90,
    endedAt: 100,
    now: 100,
    ...overrides,
  });
}

describe('recallRecentEpisodes', () => {
  it('returns empty array when no episodes exist', () => {
    const episodes = recallRecentEpisodes({ threadId: 'conv-1' });
    expect(episodes).toEqual([]);
  });

  it('returns episodes ordered by ended_at DESC', () => {
    const now = Date.now();
    makeEpisode({ summary: 'First', endedAt: now - 2000, startedAt: now - 2000 });
    makeEpisode({ summary: 'Second', endedAt: now - 1000, startedAt: now - 1000 });
    makeEpisode({ summary: 'Third', endedAt: now, startedAt: now });

    const episodes = recallRecentEpisodes({ threadId: 'conv-1' });
    expect(episodes).toHaveLength(3);
    expect(episodes.map((e) => e.summary)).toEqual(['Third', 'Second', 'First']);
  });

  it('respects the limit parameter', () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      makeEpisode({
        summary: `Episode ${i}`,
        endedAt: now - i * 1000,
        startedAt: now - i * 1000,
      });
    }

    const episodes = recallRecentEpisodes({ threadId: 'conv-1', limit: 2 });
    expect(episodes).toHaveLength(2);
    expect(episodes[0].summary).toBe('Episode 0');
    expect(episodes[1].summary).toBe('Episode 1');
  });

  it('caps direct presentation at the named safe maximum', () => {
    const now = Date.now();
    for (let i = 0; i < 25; i++) {
      makeEpisode({
        summary: `Episode ${i}`,
        endedAt: now - i * 100,
        startedAt: now - i * 100,
      });
    }

    const episodes = recallRecentEpisodes({ threadId: 'conv-1', limit: 100 });
    expect(episodes).toHaveLength(EPISODE_PRESENTATION_MAX);
  });

  it('filters by threadId', () => {
    const now = Date.now();
    makeEpisode({ threadId: 'thread-a', summary: 'A', endedAt: now, startedAt: now });
    makeEpisode({ threadId: 'thread-b', summary: 'B', endedAt: now, startedAt: now });

    const episodes = recallRecentEpisodes({ threadId: 'thread-a' });
    expect(episodes).toHaveLength(1);
    expect(episodes[0].summary).toBe('A');
  });

  it('filters by conversationId when threadId is omitted', () => {
    const now = Date.now();
    makeEpisode({
      conversationId: 'conv-a',
      threadId: 'conv-a',
      summary: 'A',
      endedAt: now,
      startedAt: now,
    });
    makeEpisode({
      conversationId: 'conv-b',
      threadId: 'conv-b',
      summary: 'B',
      endedAt: now,
      startedAt: now,
    });

    const episodes = recallRecentEpisodes({ conversationId: 'conv-a' });
    expect(episodes).toHaveLength(1);
    expect(episodes[0].summary).toBe('A');
  });

  it('filters by taskId', () => {
    const now = Date.now();
    makeEpisode({ taskId: 'task-1', summary: 'Task 1', endedAt: now, startedAt: now });
    makeEpisode({ taskId: 'task-2', summary: 'Task 2', endedAt: now, startedAt: now });

    const episodes = recallRecentEpisodes({ taskId: 'task-1' });
    expect(episodes).toHaveLength(1);
    expect(episodes[0].summary).toBe('Task 1');
  });

  it('filters by maxAgeMs', () => {
    const now = Date.now();
    makeEpisode({ summary: 'Recent', endedAt: now - 5000, startedAt: now - 5000 });
    makeEpisode({ summary: 'Old', endedAt: now - 60000, startedAt: now - 60000 });

    const episodes = recallRecentEpisodes({ threadId: 'conv-1', maxAgeMs: 10000 });
    expect(episodes).toHaveLength(1);
    expect(episodes[0].summary).toBe('Recent');
  });

  it('excludes soft-deleted episodes', () => {
    const now = Date.now();
    makeEpisode({ summary: 'Active', endedAt: now, startedAt: now });
    const deleted = makeEpisode({ summary: 'Deleted', endedAt: now, startedAt: now });

    // Soft-delete the second episode
    const { getMemoryDb } = require('../../../src/services/memory/sqlite-store');
    getMemoryDb().runSync(
      'UPDATE memory_episodes SET deleted_at = ? WHERE id = ?',
      now,
      deleted.id,
    );

    const episodes = recallRecentEpisodes({ threadId: 'conv-1' });
    expect(episodes).toHaveLength(1);
    expect(episodes[0].summary).toBe('Active');
  });

  it('returns episodes with correct shape', () => {
    const now = Date.now();
    const created = makeEpisode({
      summary: 'Shape test',
      endedAt: now,
      startedAt: now - 5000,
      entities: ['user', 'project'],
      messageIds: ['m1', 'm2'],
      toolNames: ['read_file'],
      importance: 0.8,
    });

    const episodes = recallRecentEpisodes({ threadId: 'conv-1' });
    expect(episodes).toHaveLength(1);
    const ep = episodes[0];
    expect(ep.id).toBe(created.id);
    expect(ep.summary).toBe('Shape test');
    expect(ep.startedAt).toBe(now - 5000);
    expect(ep.endedAt).toBe(now);
    expect(ep.entities).toEqual(['user', 'project']);
    expect(ep.messageIds).toEqual(['m1', 'm2']);
    expect(ep.toolNames).toEqual(['read_file']);
    expect(ep.importance).toBe(0.8);
    expect(ep.embedding).toBeNull();
  });
});

describe('recallEpisodesForQuery', () => {
  it('prefers relevant older episodes over unrelated recent episodes', () => {
    makeEpisode({
      summary: 'Unrelated shopping workflow',
      endedAt: 3_000,
      startedAt: 3_000,
    });
    makeEpisode({
      summary: 'Fraud status filter investigation',
      endedAt: 1_000,
      startedAt: 1_000,
      toolNames: ['browser_observe'],
    });

    const episodes = recallEpisodesForQuery('fraud status filter', {
      threadId: 'conv-1',
      limit: 1,
    });

    expect(episodes).toHaveLength(1);
    expect(episodes[0].summary).toBe('Fraud status filter investigation');
  });

  it('uses recency as the deterministic tie-breaker after relevance and importance', () => {
    makeEpisode({
      summary: 'equal relevance older',
      importance: 0.5,
      endedAt: 1_000,
      startedAt: 1_000,
    });
    makeEpisode({
      summary: 'equal relevance newer',
      importance: 0.5,
      endedAt: 2_000,
      startedAt: 2_000,
    });

    const episodes = recallEpisodesForQuery('equal relevance', {
      threadId: 'conv-1',
      limit: 2,
    });

    expect(episodes.map((episode) => episode.summary)).toEqual([
      'equal relevance newer',
      'equal relevance older',
    ]);
  });

  it('admits locked relevant episodes across the real product candidate window', () => {
    expect(EPISODE_QUERY_CANDIDATE_MIN).toBeGreaterThan(40);
    const anchor = 100_000;
    const relevantByPosition = new Map([
      [4, { summary: 'locked recall early', importance: 0.2 }],
      [31, { summary: 'locked recall middle', importance: 0.5 }],
      [63, { summary: 'locked recall late', importance: 0.9 }],
    ]);
    for (let position = 0; position < EPISODE_QUERY_CANDIDATE_MIN; position += 1) {
      const relevant = relevantByPosition.get(position);
      makeEpisode({
        summary: relevant?.summary ?? `unrelated distractor ${position}`,
        importance: relevant?.importance ?? 0.1,
        endedAt: anchor - position,
        startedAt: anchor - position,
      });
    }

    let timing: RecallEpisodesTiming | undefined;
    const episodes = recallEpisodesForQuery('locked recall', {
      threadId: 'conv-1',
      limit: 4,
      onTiming: (value) => {
        timing = value;
      },
    });

    expect(episodes.map((episode) => episode.summary)).toEqual([
      'locked recall late',
      'locked recall middle',
      'locked recall early',
    ]);
    expect(timing).toMatchObject({
      queryUnitCount: 2,
      candidateLimit: EPISODE_QUERY_CANDIDATE_MIN,
      candidateCount: 3,
      resultLimit: 4,
      resultCount: 3,
    });
  });

  it('keeps query results presentation-bounded while candidate fetch reaches its ceiling', () => {
    const anchor = 200_000;
    for (let position = 0; position < 100; position += 1) {
      makeEpisode({
        summary: `bounded candidate ${position}`,
        endedAt: anchor - position,
        startedAt: anchor - position,
      });
    }

    let timing: RecallEpisodesTiming | undefined;
    const episodes = recallEpisodesForQuery('bounded candidate', {
      threadId: 'conv-1',
      limit: 100,
      onTiming: (value) => {
        timing = value;
      },
    });

    expect(episodes).toHaveLength(EPISODE_PRESENTATION_MAX);
    expect(timing).toMatchObject({
      candidateLimit: EPISODE_QUERY_CANDIDATE_MAX,
      candidateCount: EPISODE_QUERY_CANDIDATE_MAX,
      resultLimit: EPISODE_PRESENTATION_MAX,
      resultCount: EPISODE_PRESENTATION_MAX,
    });
  });

  it.each([79, 80, 81])(
    'finds an older relevant episode behind %i newer non-matching episodes',
    (distractorCount) => {
      const anchor = 250_000;
      for (let position = 0; position < distractorCount; position += 1) {
        makeEpisode({
          summary: `garden distractor ${position}`,
          endedAt: anchor - position,
          startedAt: anchor - position,
        });
      }
      makeEpisode({
        summary: 'indexed continuity target',
        endedAt: 1_000,
        startedAt: 1_000,
      });

      expect(
        recallEpisodesForQuery('indexed continuity', {
          threadId: 'conv-1',
          limit: 1,
        })[0]?.summary,
      ).toBe('indexed continuity target');
    },
  );

  it('updates and deletes episode retrieval terms with the source episode', () => {
    const source = {
      conversationId: 'conv-1',
      threadId: 'conv-1',
      messageIds: ['index-user', 'index-assistant'],
      sourceStartMessageId: 'index-user',
      sourceEndMessageId: 'index-assistant',
      startedAt: 1_000,
      endedAt: 2_000,
      now: 2_000,
    } as const;
    const created = makeEpisode({ ...source, summary: 'obsolete retrieval token' });
    const replay = makeEpisode({ ...source, summary: 'current retrieval token' });

    expect(replay.id).toBe(created.id);
    expect(recallEpisodesForQuery('obsolete', { threadId: 'conv-1' })).toEqual([]);
    expect(recallEpisodesForQuery('current', { threadId: 'conv-1' })[0]?.id).toBe(created.id);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_episode_terms WHERE episode_id = ?',
        created.id,
      )?.count,
    ).toBeGreaterThan(0);

    getMemoryDb().runSync('DELETE FROM memory_episodes WHERE id = ?', created.id);

    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_episode_terms WHERE episode_id = ?',
        created.id,
      )?.count,
    ).toBe(0);
  });

  it('backfills the retrieval index for episodes created before the index version marker', () => {
    getMemoryDb().runSync(
      `INSERT INTO memory_episodes(
         id, conversation_id, thread_id, task_id, started_at, ended_at, summary,
         entities_json, message_ids_json, tool_names_json, importance, embedding,
         created_at, deleted_at, source_start_message_id, source_end_message_id
       ) VALUES (?, ?, ?, NULL, 1, 2, ?, '[]', '["legacy-user","legacy-assistant"]',
                 '[]', 0.5, NULL, 2, NULL, 'legacy-user', 'legacy-assistant')`,
      'legacy-index-episode',
      'conv-1',
      'conv-1',
      'legacy backfill needle',
    );
    getMemoryDb().runSync('DELETE FROM memory_episode_retrieval_index_meta');
    resetFactSchemaCacheForTests();

    ensureFactSchema();

    expect(recallEpisodesForQuery('backfill needle', { threadId: 'conv-1' })[0]?.id).toBe(
      'legacy-index-episode',
    );
  });

  it('preserves query scope, deletion, task, and age filters', () => {
    const now = Date.now();
    makeEpisode({
      threadId: 'other-thread',
      taskId: 'task-1',
      summary: 'filtered anchor wrong thread',
      endedAt: now,
      startedAt: now,
    });
    makeEpisode({
      taskId: 'task-2',
      summary: 'filtered anchor wrong task',
      endedAt: now,
      startedAt: now,
    });
    makeEpisode({
      taskId: 'task-1',
      summary: 'filtered anchor too old',
      endedAt: now - 20_000,
      startedAt: now - 20_000,
    });
    const deleted = makeEpisode({
      taskId: 'task-1',
      summary: 'filtered anchor deleted',
      endedAt: now - 2,
      startedAt: now - 2,
    });
    makeEpisode({
      taskId: 'task-1',
      summary: 'filtered anchor eligible',
      endedAt: now - 1,
      startedAt: now - 1,
    });
    const { getMemoryDb } = require('../../../src/services/memory/sqlite-store');
    getMemoryDb().runSync(
      'UPDATE memory_episodes SET deleted_at = ? WHERE id = ?',
      now,
      deleted.id,
    );

    const episodes = recallEpisodesForQuery('filtered anchor', {
      threadId: 'conv-1',
      taskId: 'task-1',
      maxAgeMs: 10_000,
      limit: 4,
    });

    expect(episodes.map((episode) => episode.summary)).toEqual(['filtered anchor eligible']);
  });

  it('keeps warmed local episode-query p95 within the recorded budget', () => {
    const anchor = 300_000;
    for (let position = 0; position < EPISODE_QUERY_CANDIDATE_MAX; position += 1) {
      makeEpisode({
        summary:
          position === EPISODE_QUERY_CANDIDATE_MAX - 1
            ? 'latency target episode'
            : `latency distractor ${position}`,
        endedAt: anchor - position,
        startedAt: anchor - position,
      });
    }
    const recall = () =>
      recallEpisodesForQuery('latency target', { threadId: 'conv-1', limit: 20 });
    for (let warmup = 0; warmup < 5; warmup += 1) recall();

    const durations: number[] = [];
    for (let sample = 0; sample < 40; sample += 1) {
      const started = performance.now();
      expect(recall()[0]?.summary).toBe('latency target episode');
      durations.push(performance.now() - started);
    }
    durations.sort((left, right) => left - right);
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1]!;

    expect(p95).toBeLessThanOrEqual(EPISODE_RECALL_LOCAL_P95_BUDGET_MS);
  });
});

describe('recallScopedEpisodesForQuery', () => {
  it('keeps root and source thread distinct while current-first filling with authorized cross-thread continuity', () => {
    const db = getMemoryDb();
    const ownerId = getLocalMemoryVaultOwnerId(db);
    const current = makeCompleteEpisode('current', {
      threadId: 'thread-current',
      summary: 'release current checkpoint',
    });
    makeCompleteEpisode('wrong-root', {
      conversationId: 'other-root',
      threadId: 'thread-current',
      summary: 'release forbidden root',
    });
    makeCompleteEpisode('task-local', {
      threadId: 'thread-current',
      taskId: 'task-private',
      summary: 'release forbidden task',
    });
    const cross = makeCompleteEpisode('cross', {
      threadId: 'thread-cross',
      summary: 'release cross continuity',
    });
    bindEpisodeAccessPolicy(
      db,
      {
        episodeId: cross.id,
        memoryOwnerId: ownerId,
        memoryConversationId: 'root-conversation',
        sourceThreadId: 'thread-cross',
        personaId: DEFAULT_MEMORY_PERSONA_ID,
        taskId: null,
        shareability: 'session_threads',
        sensitivity: 'normal',
        boundAt: 100,
      },
      100,
    );

    let timing: RecallEpisodesTiming | undefined;
    const result = recallScopedEpisodesForQuery('release continuity checkpoint', {
      currentScope: {
        memoryOwnerId: ownerId,
        memoryConversationId: 'root-conversation',
        sourceThreadId: 'thread-current',
        personaId: DEFAULT_MEMORY_PERSONA_ID,
        taskId: null,
      },
      limit: 2,
      now: 200,
      onTiming: (value) => {
        timing = value;
      },
    });

    expect(result.selections).toHaveLength(2);
    expect(result.selections[0]).toMatchObject({
      lane: 'current_thread',
      episode: { id: current.id },
      authorizedOrigin: null,
    });
    expect(result.selections[1]).toMatchObject({
      lane: 'cross_thread',
      episode: { id: cross.id },
      authorizedOrigin: {
        memoryOwnerId: ownerId,
        memoryConversationId: 'root-conversation',
        sourceThreadId: 'thread-cross',
        personaId: DEFAULT_MEMORY_PERSONA_ID,
        taskId: null,
      },
    });
    expect(result.selections.map((selection) => selection.episode.summary)).not.toEqual(
      expect.arrayContaining(['release forbidden root', 'release forbidden task']),
    );
    expect(timing).toMatchObject({
      candidateCount: 2,
      resultCount: 2,
      resultLimit: 2,
    });
    expect(timing!.totalMs).toBeGreaterThanOrEqual(timing!.fetchMs);
    expect(timing!.totalMs).toBeGreaterThanOrEqual(timing!.scoreMs);
    expect(timing!.totalMs).toBeGreaterThanOrEqual(timing!.sortMs);
    expect(result.diagnostics).toMatchObject({
      scannedCount: 1,
      eligibleCount: 1,
      selectedCount: 1,
    });
  });

  it('reports current-only candidates without inventing cross-thread work', () => {
    makeCompleteEpisode('only-current', {
      threadId: 'thread-current',
      summary: 'release current only',
    });
    let timing: RecallEpisodesTiming | undefined;

    const result = recallScopedEpisodesForQuery('release current', {
      currentScope: {
        memoryOwnerId: getLocalMemoryVaultOwnerId(getMemoryDb()),
        memoryConversationId: 'root-conversation',
        sourceThreadId: 'thread-current',
        personaId: DEFAULT_MEMORY_PERSONA_ID,
        taskId: null,
      },
      limit: 2,
      now: 200,
      onTiming: (value) => {
        timing = value;
      },
    });

    expect(result.selections).toEqual([expect.objectContaining({ lane: 'current_thread' })]);
    expect(result.diagnostics).toMatchObject({ scannedCount: 0, eligibleCount: 0 });
    expect(timing).toMatchObject({ candidateCount: 1, resultCount: 1 });
  });
});
