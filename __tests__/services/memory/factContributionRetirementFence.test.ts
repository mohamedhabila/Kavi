jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { insertRetiredMemorySourceForTest } from '../../helpers/memoryWithdrawalFixtures';
import { subscribeToMemoryChanges } from '../../../src/services/memory/changeNotifications';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import type {
  MemoryFactContributionSourceAlias,
  MemoryFactContributionSourceKind,
} from '../../../src/services/memory/factContributionCodec';
import {
  loadFactContributionReplayFromAliasCandidates,
  persistFactContributionInTransaction,
  type MemoryFactContributionWriteContext,
} from '../../../src/services/memory/factContributionStore';
import { normalizeRecordFactMutation } from '../../../src/services/memory/facts/mutationNormalization';
import {
  recordFactWithApplicability,
  recordFactWithContribution,
} from '../../../src/services/memory/facts/mutations';
import { runMemoryTransaction } from '../../../src/services/memory/access/transaction';
import {
  clearStructuredMemory,
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { MemoryPersistenceSourceWithdrawnError } from '../../../src/services/memory/withdrawalFence';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const grounded = { factClass: 'subjective_user', sourceAuthority: 'grounded_user' } as const;
const scope = {
  memoryConversationId: 'conversation-1',
  sourceThreadId: 'thread-1',
  taskId: null,
};
const aliases: MemoryFactContributionSourceAlias[] = [
  { sourceKind: 'message', sourceId: 'message-1' },
  { sourceKind: 'turn', sourceId: 'turn-1' },
  { sourceKind: 'run', sourceId: 'run-1' },
];

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  clearStructuredMemory();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

function contributionContext(): MemoryFactContributionWriteContext {
  return {
    ...scope,
    producer: { producerId: 'retirement_fence_test', producerEventId: 'event-1' },
    sourceAliases: aliases,
  };
}

function recordInput(subjectId: string) {
  return {
    subjectId,
    predicate: 'favorite_color',
    objectText: 'blue',
    scope: 'global' as const,
    sourceMessageId: 'message-1',
    sourceTurnId: 'turn-1',
    sourceRunId: 'run-1',
    now: 100,
  };
}

function counts(): { facts: number; terms: number; contributions: number; aliases: number } {
  const db = getMemoryDb();
  const count = (table: string): number =>
    db.getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)?.count ?? 0;
  return {
    facts: count('memory_facts'),
    terms: count('memory_fact_terms'),
    contributions: count('memory_fact_contributions'),
    aliases: count('memory_fact_contribution_sources'),
  };
}

function retire(sourceKind: MemoryFactContributionSourceKind): void {
  const sourceId = aliases.find((alias) => alias.sourceKind === sourceKind)!.sourceId;
  insertRetiredMemorySourceForTest({
    retirementGroupId: `retired-${sourceKind}`,
    ...scope,
    sourceKind,
    sourceId,
  });
}

it.each(['message', 'turn', 'run'] as const)(
  'rolls a new contribution back when its %s alias is retired',
  (sourceKind) => {
    const subjectId = upsertEntity({ name: 'user', type: 'self', now: 1 }).id;
    retire(sourceKind);
    const listener = jest.fn();
    const unsubscribe = subscribeToMemoryChanges(listener);

    let thrown: unknown;
    try {
      recordFactWithContribution(recordInput(subjectId), grounded, contributionContext());
    } catch (error) {
      thrown = error;
    } finally {
      unsubscribe();
    }

    expect(thrown).toBeInstanceOf(MemoryPersistenceSourceWithdrawnError);
    expect(thrown).toMatchObject({ code: 'memory_persistence_source_withdrawn' });
    expect(counts()).toEqual({ facts: 0, terms: 0, contributions: 0, aliases: 0 });
    expect(listener).not.toHaveBeenCalled();
  },
);

it('does not broaden retirement across source kind, thread, or task identity', () => {
  const subjectId = upsertEntity({ name: 'user', type: 'self', now: 1 }).id;
  insertRetiredMemorySourceForTest({
    retirementGroupId: 'retired-sibling-kind',
    ...scope,
    sourceKind: 'turn',
    sourceId: 'message-1',
  });
  getMemoryDb().runSync(
    `INSERT INTO memory_retired_sources(
       retirement_group_id, memory_owner_id, memory_conversation_id,
       source_thread_id, task_id, source_kind, source_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    'retired-sibling-kind',
    'foreign-owner',
    scope.memoryConversationId,
    scope.sourceThreadId,
    '',
    'message',
    'message-1',
  );
  insertRetiredMemorySourceForTest({
    retirementGroupId: 'retired-sibling-thread',
    ...scope,
    sourceThreadId: 'thread-2',
    sourceKind: 'message',
    sourceId: 'message-1',
  });
  insertRetiredMemorySourceForTest({
    retirementGroupId: 'retired-sibling-task',
    ...scope,
    taskId: 'task-1',
    sourceKind: 'message',
    sourceId: 'message-1',
  });

  expect(
    recordFactWithContribution(recordInput(subjectId), grounded, contributionContext()),
  ).toMatchObject({ status: 'created' });
  const persisted = counts();
  expect(persisted).toMatchObject({ facts: 1, contributions: 1, aliases: 3 });
  expect(persisted.terms).toBeGreaterThan(0);
});

it('fences only the durable alias set selected from replay candidates', () => {
  const subjectId = upsertEntity({ name: 'user', type: 'self', now: 1 }).id;
  recordFactWithContribution(recordInput(subjectId), grounded, contributionContext());
  insertRetiredMemorySourceForTest({
    retirementGroupId: 'retired-unused-candidate',
    ...scope,
    sourceKind: 'message',
    sourceId: 'unused-prior-message',
  });

  const replay = loadFactContributionReplayFromAliasCandidates({
    context: contributionContext(),
    sourceAliasCandidates: [
      aliases,
      [...aliases, { sourceKind: 'message', sourceId: 'unused-prior-message' }],
    ],
  });
  expect(replay?.sourceAliases).toHaveLength(aliases.length);
  expect(replay?.sourceAliases).toEqual(expect.arrayContaining(aliases));
});

it('defers retirement when an absent replay has multiple candidate alias sets', () => {
  insertRetiredMemorySourceForTest({
    retirementGroupId: 'retired-ambiguous-candidate',
    ...scope,
    sourceKind: 'message',
    sourceId: 'optional-prior-message',
  });

  expect(
    loadFactContributionReplayFromAliasCandidates({
      context: contributionContext(),
      sourceAliasCandidates: [
        aliases,
        [...aliases, { sourceKind: 'message', sourceId: 'optional-prior-message' }],
      ],
    }),
  ).toBeNull();
});

it('keeps the final contribution store fenced independently of replay loading', () => {
  const subjectId = upsertEntity({ name: 'user', type: 'self', now: 1 }).id;
  const input = recordInput(subjectId);
  const fact = recordFactWithApplicability(input, grounded).fact;
  const before = counts();
  retire('message');

  expect(() =>
    runMemoryTransaction(() =>
      persistFactContributionInTransaction({
        fact,
        payload: normalizeRecordFactMutation(input, grounded),
        context: contributionContext(),
      }),
    ),
  ).toThrow(MemoryPersistenceSourceWithdrawnError);
  expect(counts()).toEqual(before);
});

it('prevents exact replay projection repair after retirement', () => {
  const subjectId = upsertEntity({ name: 'user', type: 'self', now: 1 }).id;
  const first = recordFactWithContribution(
    { ...recordInput(subjectId), pinned: true },
    grounded,
    contributionContext(),
  );
  const before = counts();
  getMemoryDb().runSync('UPDATE memory_facts SET pinned = 0 WHERE id = ?', first.fact.id);
  retire('message');
  const listener = jest.fn();
  const unsubscribe = subscribeToMemoryChanges(listener);

  try {
    expect(() =>
      recordFactWithContribution(
        { ...recordInput(subjectId), pinned: true },
        grounded,
        contributionContext(),
      ),
    ).toThrow(MemoryPersistenceSourceWithdrawnError);
  } finally {
    unsubscribe();
  }

  expect(counts()).toEqual(before);
  expect(
    getMemoryDb().getFirstSync<{ pinned: number }>(
      'SELECT pinned FROM memory_facts WHERE id = ?',
      first.fact.id,
    ),
  ).toEqual({ pinned: 0 });
  expect(listener).not.toHaveBeenCalled();
});
