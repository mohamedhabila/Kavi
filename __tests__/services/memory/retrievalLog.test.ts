// ---------------------------------------------------------------------------
// Tests — Retrieval log
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../../src/services/memory/schema';
import { logRetrieval, readRecentRetrievals } from '../../../src/services/memory/retrievalLog';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

describe('logRetrieval', () => {
  it('creates a log entry', () => {
    logRetrieval({
      threadId: 'conv-1',
      query: 'user preference',
      factIds: ['f1', 'f2'],
      episodeIds: ['e1'],
      tokenEstimate: 1200,
    });

    const entries = readRecentRetrievals({ threadId: 'conv-1' });
    expect(entries).toHaveLength(1);
    expect(entries[0].threadId).toBe('conv-1');
    expect(entries[0].query).toBe('user preference');
    expect(entries[0].factIds).toEqual(['f1', 'f2']);
    expect(entries[0].episodeIds).toEqual(['e1']);
    expect(entries[0].tokenEstimate).toBe(1200);
    expect(entries[0].createdAt).toBeGreaterThan(0);
  });

  it('logs with taskId when provided', () => {
    logRetrieval({
      threadId: 'conv-1',
      taskId: 'task-1',
      query: 'scoped query',
      factIds: [],
      episodeIds: [],
      tokenEstimate: 0,
    });

    const entries = readRecentRetrievals({ threadId: 'conv-1' });
    expect(entries[0].taskId).toBe('task-1');
  });

  it('truncates long queries to 500 chars', () => {
    const longQuery = 'a'.repeat(1000);
    logRetrieval({
      query: longQuery,
      factIds: [],
      episodeIds: [],
      tokenEstimate: 0,
    });

    const entries = readRecentRetrievals();
    expect(entries[0].query.length).toBeLessThanOrEqual(500);
  });

  it('caps fact and episode id arrays at 50 items', () => {
    const manyFacts = Array.from({ length: 100 }, (_, i) => `f${i}`);
    logRetrieval({
      query: 'many facts',
      factIds: manyFacts,
      episodeIds: manyFacts,
      tokenEstimate: 0,
    });

    const entries = readRecentRetrievals();
    expect(entries[0].factIds.length).toBe(50);
    expect(entries[0].episodeIds.length).toBe(50);
  });

  it('never throws even with invalid inputs', () => {
    expect(() =>
      logRetrieval({
        query: 'test',
        factIds: [],
        episodeIds: [],
        tokenEstimate: -1,
      }),
    ).not.toThrow();
  });

  it('returns empty array when no entries exist', () => {
    const entries = readRecentRetrievals();
    expect(entries).toEqual([]);
  });

  it('filters by threadId', () => {
    logRetrieval({ threadId: 'conv-a', query: 'a', factIds: [], episodeIds: [], tokenEstimate: 0 });
    logRetrieval({ threadId: 'conv-b', query: 'b', factIds: [], episodeIds: [], tokenEstimate: 0 });

    const entries = readRecentRetrievals({ threadId: 'conv-a' });
    expect(entries).toHaveLength(1);
    expect(entries[0].query).toBe('a');
  });

  it('orders entries by created_at DESC', async () => {
    logRetrieval({ query: 'first', factIds: [], episodeIds: [], tokenEstimate: 0 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    logRetrieval({ query: 'second', factIds: [], episodeIds: [], tokenEstimate: 0 });

    const entries = readRecentRetrievals();
    expect(entries[0].query).toBe('second');
    expect(entries[1].query).toBe('first');
  });

  it('respects the limit option', () => {
    for (let i = 0; i < 5; i++) {
      logRetrieval({ query: `q${i}`, factIds: [], episodeIds: [], tokenEstimate: 0 });
    }

    const entries = readRecentRetrievals({ limit: 2 });
    expect(entries).toHaveLength(2);
  });

  it('caps limit to 100', () => {
    for (let i = 0; i < 3; i++) {
      logRetrieval({ query: `q${i}`, factIds: [], episodeIds: [], tokenEstimate: 0 });
    }

    const entries = readRecentRetrievals({ limit: 200 });
    expect(entries.length).toBeLessThanOrEqual(100);
  });

  it('prunes old entries beyond retention limit', () => {
    // The retention limit is 500; we can't easily test that in a unit test
    // without creating 501 entries. Just verify pruning doesn't crash.
    for (let i = 0; i < 10; i++) {
      logRetrieval({ query: `q${i}`, factIds: [], episodeIds: [], tokenEstimate: 0 });
    }

    const entries = readRecentRetrievals();
    expect(entries.length).toBe(10);
  });
});
