jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { resolvePriorUserSelfCorrectionFacts } from '../../../src/services/memory/facts/currentReplacementResolution';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import type { MemoryFactScope } from '../../../src/services/memory/facts/types';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const SOURCE_MESSAGE_ID = 'user-prior-scope';

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => closeMemoryDb());

function seed(input: {
  predicate: string;
  scope: MemoryFactScope;
  personaId?: string;
  originConversationId?: string;
  originThreadId?: string;
  originTaskId?: string;
}) {
  const user = upsertEntity({ name: 'user', type: 'self' });
  return recordFactWithApplicability(
    {
      subjectId: user.id,
      predicate: input.predicate,
      objectText: input.predicate,
      scope: input.scope,
      sourceMessageId: SOURCE_MESSAGE_ID,
      originConversationId: input.originConversationId,
      originThreadId: input.originThreadId,
      originTaskId: input.originTaskId,
    },
    {
      factClass: 'subjective_user',
      sourceAuthority: 'grounded_user',
      personaId: input.personaId ?? null,
    },
  ).fact;
}

function resolve(
  scope: MemoryFactScope,
  context: {
    memoryConversationId: string;
    sourceThreadId: string;
    taskId?: string;
    personaId?: string;
  },
) {
  return resolvePriorUserSelfCorrectionFacts(
    { subject: 'user', sourceMessageId: SOURCE_MESSAGE_ID, scope },
    context,
  ).map((fact) => fact.predicate);
}

it('isolates prior-message correction candidates by exact durable scope identity', () => {
  seed({ predicate: 'global_preference', scope: 'global' });
  seed({ predicate: 'persona_one', scope: 'persona', personaId: 'persona-1' });
  seed({ predicate: 'persona_two', scope: 'persona', personaId: 'persona-2' });
  seed({
    predicate: 'conversation_root_one',
    scope: 'conversation',
    originConversationId: 'root-1',
    originThreadId: 'older-thread',
  });
  seed({
    predicate: 'conversation_root_two',
    scope: 'conversation',
    originConversationId: 'root-2',
    originThreadId: 'other-thread',
  });
  seed({
    predicate: 'project_root_one',
    scope: 'project',
    originConversationId: 'root-1',
    originThreadId: 'project-thread',
  });
  seed({
    predicate: 'session_task_one',
    scope: 'session',
    originConversationId: 'root-1',
    originThreadId: 'current-thread',
    originTaskId: 'task-1',
  });
  seed({
    predicate: 'session_task_two',
    scope: 'session',
    originConversationId: 'root-1',
    originThreadId: 'current-thread',
    originTaskId: 'task-2',
  });

  expect(
    resolve('global', { memoryConversationId: 'root-1', sourceThreadId: 'current-thread' }),
  ).toEqual(['global_preference']);
  expect(
    resolve('persona', {
      memoryConversationId: 'root-1',
      sourceThreadId: 'current-thread',
      personaId: 'persona-1',
    }),
  ).toEqual(['persona_one']);
  expect(
    resolve('conversation', {
      memoryConversationId: 'root-1',
      sourceThreadId: 'current-thread',
    }),
  ).toEqual(['conversation_root_one']);
  expect(
    resolve('project', {
      memoryConversationId: 'root-1',
      sourceThreadId: 'current-thread',
    }),
  ).toEqual(['project_root_one']);
  expect(
    resolve('session', {
      memoryConversationId: 'root-1',
      sourceThreadId: 'current-thread',
      taskId: 'task-1',
    }),
  ).toEqual(['session_task_one']);
  expect(
    resolve('session', {
      memoryConversationId: 'root-1',
      sourceThreadId: 'current-thread',
      taskId: 'missing-task',
    }),
  ).toEqual([]);
});
