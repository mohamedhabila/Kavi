// ---------------------------------------------------------------------------
// Tests — Episode recall (recency-based retrieval)
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { recordEpisode } from '../../../src/services/memory/episodes/mutations';
import { recallRecentEpisodes } from '../../../src/services/memory/episodeRecall';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

function makeEpisode(overrides: Partial<Parameters<typeof recordEpisode>[0]> = {}) {
  const episode = recordEpisode({
    conversationId: 'conv-1',
    threadId: 'conv-1',
    summary: 'Test episode',
    startedAt: Date.now(),
    endedAt: Date.now(),
    ...overrides,
  });
  if (!episode) throw new Error('recordEpisode returned null');
  return episode;
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

  it('caps limit to 20', () => {
    const now = Date.now();
    for (let i = 0; i < 25; i++) {
      makeEpisode({
        summary: `Episode ${i}`,
        endedAt: now - i * 100,
        startedAt: now - i * 100,
      });
    }

    const episodes = recallRecentEpisodes({ threadId: 'conv-1', limit: 100 });
    expect(episodes).toHaveLength(20);
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
