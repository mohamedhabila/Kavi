jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  ACCEPTANCE_FACT_PRODUCER_IDS,
  recordAcceptanceFixtureFact,
  type AcceptanceFactContributionIdentity,
} from '../../src/acceptance/acceptanceFactContributions';
import { closeMemoryDb, getMemoryDb } from '../../src/services/memory/database';
import { upsertEntity } from '../../src/services/memory/entities';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const APPLICABILITY = {
  factClass: 'workflow',
  sourceAuthority: 'tool_observed',
} as const;

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

function identity(
  overrides: Partial<AcceptanceFactContributionIdentity> = {},
): AcceptanceFactContributionIdentity {
  return {
    producerId: ACCEPTANCE_FACT_PRODUCER_IDS.memoryHybridAblation,
    fixtureId: 'fixture-one',
    eventKey: 'fact-one',
    memoryConversationId: 'fixture-conversation',
    sourceThreadId: 'fixture-thread',
    taskId: null,
    sourceKind: 'turn',
    sourceId: 'fixture-turn',
    ...overrides,
  };
}

function recordFixtureFact(subjectId: string, objectText: string, sourceIdentity = identity()) {
  return recordAcceptanceFixtureFact(
    {
      subjectId,
      predicate: 'fixture_value',
      objectText,
      scope: 'global',
      now: 100,
    },
    APPLICABILITY,
    sourceIdentity,
  );
}

describe('acceptance fixture fact contributions', () => {
  it('replays one exact fixture event without duplicating its immutable contribution', () => {
    const subject = upsertEntity({ name: 'fixture subject', type: 'concept', now: 90 });

    expect(recordFixtureFact(subject.id, 'blue').status).toBe('created');
    expect(recordFixtureFact(subject.id, 'blue').status).toBe('duplicate');

    expect(
      getMemoryDb().getAllSync<{
        producer_id: string;
        memory_conversation_id: string;
        source_thread_id: string;
      }>(
        `SELECT producer_id, memory_conversation_id, source_thread_id
           FROM memory_fact_contributions`,
      ),
    ).toEqual([
      {
        producer_id: ACCEPTANCE_FACT_PRODUCER_IDS.memoryHybridAblation,
        memory_conversation_id: 'fixture-conversation',
        source_thread_id: 'fixture-thread',
      },
    ]);
    expect(
      getMemoryDb().getAllSync<{ source_kind: string; source_id: string }>(
        'SELECT source_kind, source_id FROM memory_fact_contribution_sources',
      ),
    ).toEqual([{ source_kind: 'turn', source_id: 'fixture-turn' }]);
  });

  it('rolls back a payload change that reuses the same immutable fixture event', () => {
    const subject = upsertEntity({ name: 'fixture subject', type: 'concept', now: 90 });
    recordFixtureFact(subject.id, 'blue');

    expect(() => recordFixtureFact(subject.id, 'red')).toThrow(
      'memory_fact_contribution_replay_mismatch',
    );
    expect(
      getMemoryDb().getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_facts'),
    ).toEqual({ count: 1 });
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contributions',
      ),
    ).toEqual({ count: 1 });
  });

  it('isolates identical fixture event keys across exact source scopes', () => {
    const subject = upsertEntity({ name: 'fixture subject', type: 'concept', now: 90 });
    recordFixtureFact(subject.id, 'blue');
    recordFixtureFact(
      subject.id,
      'blue',
      identity({
        memoryConversationId: 'fixture-conversation-two',
        sourceThreadId: 'fixture-thread-two',
      }),
    );

    expect(
      getMemoryDb().getAllSync<{
        memory_conversation_id: string;
        source_thread_id: string;
      }>(
        `SELECT memory_conversation_id, source_thread_id
           FROM memory_fact_contributions
          ORDER BY memory_conversation_id`,
      ),
    ).toEqual([
      {
        memory_conversation_id: 'fixture-conversation',
        source_thread_id: 'fixture-thread',
      },
      {
        memory_conversation_id: 'fixture-conversation-two',
        source_thread_id: 'fixture-thread-two',
      },
    ]);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_facts'),
    ).toEqual({ count: 1 });
  });
});
