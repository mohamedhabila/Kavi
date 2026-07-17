jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  loadConsolidationCurrentFactContext,
  selectConsolidationCurrentFactContext,
} from '../../../src/services/memory/consolidation/currentFactContext';
import { closeMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => closeMemoryDb());

it('loads only authorized current facts in the exact automatic-prompt scope', () => {
  const self = upsertEntity({ name: 'user', type: 'self', now: 10 });
  const project = upsertEntity({ name: 'Apollo', type: 'project', now: 10 });
  const grounded = { factClass: 'subjective_user', sourceAuthority: 'grounded_user' } as const;
  const record = (input: Parameters<typeof recordFactWithApplicability>[0]) =>
    recordFactWithApplicability(input, grounded).fact;

  record({
    subjectId: self.id,
    predicate: 'preferred_city',
    objectText: 'Rotterdam',
    scope: 'global',
    importance: 1,
    now: 100,
  });
  record({
    subjectId: project.id,
    predicate: 'release_channel',
    objectText: 'beta',
    scope: 'conversation',
    originConversationId: 'conversation-active',
    originThreadId: 'thread-active',
    importance: 0.9,
    now: 101,
  });
  record({
    subjectId: self.id,
    predicate: 'private_health_note',
    objectText: 'sensitive value',
    scope: 'global',
    sensitivityFloor: 'sensitive',
    importance: 1,
    now: 102,
  });
  record({
    subjectId: self.id,
    predicate: 'other_conversation_state',
    objectText: 'not visible',
    scope: 'conversation',
    originConversationId: 'conversation-other',
    originThreadId: 'thread-other',
    importance: 1,
    now: 103,
  });

  expect(
    loadConsolidationCurrentFactContext({
      memoryConversationId: 'conversation-active',
      sourceThreadId: 'thread-active',
      personaId: 'persona-active',
      taskId: null,
      now: 200,
    }),
  ).toEqual([
    {
      subjectRef: { kind: 'self' },
      predicate: 'preferred_city',
      value: 'Rotterdam',
      scope: 'global',
    },
    {
      subjectRef: { kind: 'named', label: 'apollo' },
      predicate: 'release_channel',
      value: 'beta',
      scope: 'conversation',
    },
  ]);
});

it('omits ambiguous identities instead of suggesting an unsafe replacement target', () => {
  const self = upsertEntity({ name: 'user', type: 'self', now: 10 });
  const grounded = { factClass: 'subjective_user', sourceAuthority: 'grounded_user' } as const;
  const first = recordFactWithApplicability(
    {
      subjectId: self.id,
      predicate: 'preferred_city',
      objectText: 'Rotterdam',
      scope: 'global',
      supersedePrior: false,
      now: 100,
    },
    grounded,
  ).fact;
  const second = recordFactWithApplicability(
    {
      subjectId: self.id,
      predicate: 'preferred_city',
      objectText: 'Utrecht',
      scope: 'global',
      supersedePrior: false,
      now: 101,
    },
    grounded,
  ).fact;

  expect(selectConsolidationCurrentFactContext([second, first], [self])).toEqual([]);
});
