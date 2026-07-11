// ---------------------------------------------------------------------------
// Tests — countFacts & countEpisodes
// ---------------------------------------------------------------------------
// Direct COUNT(*) query tests against the real in-memory SQLite store.
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { countFacts } from '../../../src/services/memory/facts/queries';
import { recordThreadLocalEpisode } from '../../../src/services/memory/episodes/mutations';
import { countEpisodes } from '../../../src/services/memory/episodes/queries';
import { closeMemoryDb } from '../../../src/services/memory/database';
import { withdrawMemoryFact } from '../../../src/services/memory/withdrawal';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

describe('countFacts', () => {
  it('returns 0 when no facts exist', () => {
    expect(countFacts()).toBe(0);
  });

  it('counts all non-deleted facts', () => {
    recordFact({ subjectId: 'user', predicate: 'name', objectText: 'A', scope: 'global' });
    recordFact({ subjectId: 'user', predicate: 'age', objectText: '20', scope: 'global' });
    expect(countFacts()).toBe(2);
  });

  it('excludes withdrawn facts', () => {
    const result = recordFact({
      subjectId: 'user',
      predicate: 'name',
      objectText: 'A',
      scope: 'global',
    });
    expect(withdrawMemoryFact(result.fact.id).status).toBe('withdrawn');
    expect(countFacts()).toBe(0);
  });

  it('counts only pinned facts when pinnedOnly is true', () => {
    const { setFactPinned } = require('../../../src/services/memory/facts/mutations');
    const a = recordFact({
      subjectId: 'user',
      predicate: 'name',
      objectText: 'A',
      scope: 'global',
    });
    const b = recordFact({
      subjectId: 'user',
      predicate: 'age',
      objectText: '20',
      scope: 'global',
    });
    setFactPinned(a.fact.id, true);
    expect(countFacts({ pinnedOnly: true })).toBe(1);
    expect(countFacts()).toBe(2);
    expect(b.fact.pinned).toBe(false);
  });

  it('counts only facts matching scope when scope is provided', () => {
    recordFact({ subjectId: 'user', predicate: 'name', objectText: 'A', scope: 'global' });
    recordFact({
      subjectId: 'user',
      predicate: 'age',
      objectText: '20',
      scope: 'conversation',
      originConversationId: 'count-conversation',
      originThreadId: 'count-conversation',
    });
    expect(countFacts({ scope: 'global' })).toBe(1);
    expect(countFacts({ scope: 'conversation' })).toBe(1);
  });

  it('combines pinnedOnly and scope filters', () => {
    const { setFactPinned } = require('../../../src/services/memory/facts/mutations');
    const a = recordFact({
      subjectId: 'user',
      predicate: 'name',
      objectText: 'A',
      scope: 'global',
    });
    recordFact({ subjectId: 'user', predicate: 'age', objectText: '20', scope: 'global' });
    setFactPinned(a.fact.id, true);
    expect(countFacts({ pinnedOnly: true, scope: 'global' })).toBe(1);
  });
});

describe('countEpisodes', () => {
  it('returns 0 when no episodes exist', () => {
    expect(countEpisodes()).toBe(0);
  });

  it('counts all non-deleted episodes', () => {
    recordThreadLocalEpisode({
      conversationId: 'c1',
      threadId: 'c1',
      summary: 'First',
      startedAt: 1000,
      endedAt: 2000,
    });
    recordThreadLocalEpisode({
      conversationId: 'c1',
      threadId: 'c1',
      summary: 'Second',
      startedAt: 3000,
      endedAt: 4000,
    });
    expect(countEpisodes()).toBe(2);
  });

  it('filters by conversationId', () => {
    recordThreadLocalEpisode({
      conversationId: 'c1',
      threadId: 'c1',
      summary: 'A',
      startedAt: 1000,
      endedAt: 2000,
    });
    recordThreadLocalEpisode({
      conversationId: 'c2',
      threadId: 'c2',
      summary: 'B',
      startedAt: 1000,
      endedAt: 2000,
    });
    expect(countEpisodes({ conversationId: 'c1' })).toBe(1);
    expect(countEpisodes({ conversationId: 'c2' })).toBe(1);
  });

  it('filters by threadId', () => {
    recordThreadLocalEpisode({
      conversationId: 'c1',
      threadId: 't1',
      summary: 'A',
      startedAt: 1000,
      endedAt: 2000,
    });
    recordThreadLocalEpisode({
      conversationId: 'c1',
      threadId: 't2',
      summary: 'B',
      startedAt: 1000,
      endedAt: 2000,
    });
    expect(countEpisodes({ threadId: 't1' })).toBe(1);
  });

  it('filters by taskId', () => {
    recordThreadLocalEpisode({
      conversationId: 'c1',
      threadId: 'c1',
      taskId: 'task-a',
      summary: 'A',
      startedAt: 1000,
      endedAt: 2000,
    });
    recordThreadLocalEpisode({
      conversationId: 'c1',
      threadId: 'c1',
      taskId: 'task-b',
      summary: 'B',
      startedAt: 1000,
      endedAt: 2000,
    });
    expect(countEpisodes({ taskId: 'task-a' })).toBe(1);
  });
});
