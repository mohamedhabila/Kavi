jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact, invalidateFact } from '../../../src/services/memory/facts/mutations';
import { orchestrateMemoryRetrieval } from '../../../src/services/memory/retrievalOrchestrator';
import { upsertMemoryTask } from '../../../src/services/memory/tasks';
import type { AgentGoal } from '../../../src/engine/goals/types';

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

describe('orchestrateMemoryRetrieval', () => {
  it('excludes invalidated facts from retrieval', async () => {
    const entity = upsertEntity({ name: 'user', type: 'self', now: 1 });
    const kept = recordFact({
      subjectId: entity.id,
      predicate: 'prefers_theme',
      objectText: 'dark',
      scope: 'global',
      now: 1,
    }).fact;
    const removed = recordFact({
      subjectId: entity.id,
      predicate: 'prefers_theme',
      objectText: 'light',
      scope: 'global',
      now: 2,
    }).fact;
    invalidateFact(removed.id, 3);

    const result = await orchestrateMemoryRetrieval({
      userMessage: 'theme preference',
      limit: 5,
      now: 4,
    });

    expect(result.facts.some((fact) => fact.id === kept.id)).toBe(true);
    expect(result.facts.some((fact) => fact.id === removed.id)).toBe(false);
  });

  it('keeps pinned facts and uses goal signals in the query', async () => {
    const entity = upsertEntity({ name: 'project', type: 'concept', now: 1 });
    const pinned = recordFact({
      subjectId: entity.id,
      predicate: 'name',
      objectText: 'Atlas',
      scope: 'global',
      pinned: true,
      now: 1,
    }).fact;

    const goals: AgentGoal[] = [
      {
        id: 'goal-atlas',
        title: 'Atlas migration',
        status: 'active',
        dependencies: [],
        evidence: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    upsertMemoryTask({
      id: 'goal-atlas',
      threadId: 'conv-1',
      title: 'Atlas migration',
      now: 1,
    });

    const result = await orchestrateMemoryRetrieval({
      userMessage: 'status update',
      goals,
      activeTaskId: 'goal-atlas',
      conversationId: 'conv-1',
      taskId: 'goal-atlas',
      limit: 5,
      now: 2,
    });

    expect(result.querySignals).toEqual(
      expect.arrayContaining(['status update', 'Atlas migration']),
    );
    expect(result.facts.some((fact) => fact.id === pinned.id)).toBe(true);
  });

  it('uses active focus text as a retrieval signal', async () => {
    const entity = upsertEntity({ name: 'release', type: 'project', now: 1 });
    const focusFact = recordFact({
      subjectId: entity.id,
      predicate: 'handoff_token',
      objectText: 'NEBULA-FOCUS-E2E',
      scope: 'conversation',
      originConversationId: 'conv-focus',
      now: 1,
    }).fact;

    const result = await orchestrateMemoryRetrieval({
      userMessage: 'continue',
      focusText: 'NEBULA-FOCUS-E2E release validation',
      conversationId: 'conv-focus',
      limit: 5,
      now: 2,
    });

    expect(result.querySignals).toEqual(
      expect.arrayContaining(['continue', 'NEBULA-FOCUS-E2E release validation']),
    );
    expect(result.facts.some((fact) => fact.id === focusFact.id)).toBe(true);
  });
});
