jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/database';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

describe('fact source replay idempotency', () => {
  it('does not count a retried source turn as a repeated user mention', () => {
    const subject = upsertEntity({ type: 'project', name: 'release' });
    const base = {
      subjectId: subject.id,
      predicate: 'artifact_path',
      objectText: '/workspace/release.aab',
      scope: 'conversation' as const,
      originConversationId: 'conv-replay',
      originThreadId: 'thread-replay',
      sourceMessageId: 'user-1',
      sourceTurnId: 'assistant-1',
    };

    const first = recordFact({ ...base, now: 100 });
    const replay = recordFact({ ...base, now: 200 });
    const laterMention = recordFact({
      ...base,
      sourceMessageId: 'user-2',
      sourceTurnId: 'assistant-2',
      now: 300,
    });

    expect(first.status).toBe('created');
    expect(replay).toMatchObject({
      status: 'duplicate',
      fact: {
        id: first.fact.id,
        repeatedMentionCount: 0,
        updatedAt: 100,
      },
    });
    expect(laterMention).toMatchObject({
      status: 'duplicate',
      fact: {
        id: first.fact.id,
        repeatedMentionCount: 1,
        updatedAt: 300,
      },
    });
  });
});
