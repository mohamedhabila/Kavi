jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../src/services/remote/approvalStore', () => {
  const actual = jest.requireActual('../../src/services/remote/approvalStore');
  return {
    ...actual,
    requestToolApproval: jest.fn(async () => 'approved'),
  };
});

import { createGoal } from '../../src/engine/goals/types';
import { executeTool } from '../../src/engine/tools';
import { upsertEntity } from '../../src/services/memory/entities';
import { recordFactWithApplicability } from '../../src/services/memory/facts/mutations';
import { getFactById } from '../../src/services/memory/facts/queries';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../src/services/memory/sqlite-store';
import { useChatStore } from '../../src/store/useChatStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
let subjectIndex = 0;

function seedFact(input: {
  scope: 'global' | 'persona' | 'conversation' | 'project' | 'session';
  personaId?: string;
  rootId?: string;
  threadId?: string;
  taskId?: string;
}) {
  subjectIndex += 1;
  const subject = upsertEntity({
    name: `subject-${input.scope}-${subjectIndex}`,
    type: 'concept',
  });
  return recordFactWithApplicability(
    {
      subjectId: subject.id,
      predicate: 'status',
      objectText: 'ready',
      scope: input.scope,
      ...(input.rootId ? { originConversationId: input.rootId } : {}),
      ...(input.threadId ? { originThreadId: input.threadId } : {}),
      ...(input.taskId ? { originTaskId: input.taskId } : {}),
    },
    {
      factClass: 'objective',
      sourceAuthority: 'tool_observed',
      ...(input.personaId ? { personaId: input.personaId } : {}),
    },
  ).fact;
}

async function manage(input: {
  action: 'pin' | 'unpin' | 'invalidate';
  factId: string;
  rootId?: string;
  threadId?: string;
  personaId?: string;
  taskId?: string;
}) {
  const threadId = input.threadId ?? 'thread-a';
  useChatStore.setState({
    conversations: [{ id: threadId, personaId: input.personaId ?? 'default' }],
  } as never);
  return JSON.parse(
    await executeTool(
      'memory_manage',
      JSON.stringify({ action: input.action, factId: input.factId }),
      threadId,
      {
        memoryConversationId: input.rootId ?? 'root-a',
        ...(input.taskId
          ? {
              controlGraphGoals: [
                createGoal({ id: input.taskId, title: 'Scoped task', status: 'active', now: 1 }),
              ],
            }
          : {}),
      },
    ),
  ) as Record<string, unknown>;
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({ disableLongTermMemory: false });
  useChatStore.setState({ conversations: [] } as never);
  subjectIndex = 0;
});

afterEach(() => {
  closeMemoryDb();
  useChatStore.setState({ conversations: [] } as never);
});

describe('agent memory fact action authorization', () => {
  it.each([
    {
      label: 'global fact',
      fact: { scope: 'global' as const },
      execution: {},
    },
    {
      label: 'matching persona fact',
      fact: { scope: 'persona' as const, personaId: 'persona-a' },
      execution: { personaId: 'persona-a' },
    },
    {
      label: 'matching conversation fact',
      fact: { scope: 'conversation' as const, rootId: 'root-a', threadId: 'thread-a' },
      execution: { rootId: 'root-a', threadId: 'thread-a' },
    },
    {
      label: 'matching project fact',
      fact: { scope: 'project' as const, rootId: 'root-a', threadId: 'thread-a' },
      execution: { rootId: 'root-a', threadId: 'thread-a' },
    },
    {
      label: 'matching session fact',
      fact: {
        scope: 'session' as const,
        rootId: 'root-a',
        threadId: 'thread-a',
        taskId: 'task-a',
      },
      execution: { rootId: 'root-a', threadId: 'thread-a', taskId: 'task-a' },
    },
  ])('allows pinning a $label only from its exact code-owned scope', async ({ fact, execution }) => {
    const seeded = seedFact(fact);
    const result = await manage({ action: 'pin', factId: seeded.id, ...execution });

    expect(result).toMatchObject({ ok: true, status: 'pinned' });
    expect(getFactById(seeded.id)?.pinned).toBe(true);
  });

  it.each([
    {
      label: 'different persona',
      fact: { scope: 'persona' as const, personaId: 'persona-a' },
      execution: { personaId: 'persona-b' },
    },
    {
      label: 'different root',
      fact: { scope: 'conversation' as const, rootId: 'root-a', threadId: 'thread-a' },
      execution: { rootId: 'root-b', threadId: 'thread-a' },
    },
    {
      label: 'different thread',
      fact: { scope: 'conversation' as const, rootId: 'root-a', threadId: 'thread-a' },
      execution: { rootId: 'root-a', threadId: 'thread-b' },
    },
    {
      label: 'different task',
      fact: {
        scope: 'session' as const,
        rootId: 'root-a',
        threadId: 'thread-a',
        taskId: 'task-a',
      },
      execution: { rootId: 'root-a', threadId: 'thread-a', taskId: 'task-b' },
    },
  ])('denies pinning a fact from a $label without mutating it', async ({ fact, execution }) => {
    const seeded = seedFact(fact);
    const result = await manage({ action: 'pin', factId: seeded.id, ...execution });

    expect(result).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(getFactById(seeded.id)?.pinned).toBe(false);
  });

  it('applies the same exact-scope authorization to unpin and invalidate', async () => {
    const unpinFact = seedFact({
      scope: 'conversation',
      rootId: 'root-a',
      threadId: 'thread-a',
    });
    await manage({ action: 'pin', factId: unpinFact.id, rootId: 'root-a', threadId: 'thread-a' });
    const deniedUnpin = await manage({
      action: 'unpin',
      factId: unpinFact.id,
      rootId: 'root-a',
      threadId: 'thread-b',
    });

    const invalidateFact = seedFact({
      scope: 'session',
      rootId: 'root-a',
      threadId: 'thread-a',
      taskId: 'task-a',
    });
    const deniedInvalidate = await manage({
      action: 'invalidate',
      factId: invalidateFact.id,
      rootId: 'root-a',
      threadId: 'thread-a',
      taskId: 'task-b',
    });

    expect(deniedUnpin).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(getFactById(unpinFact.id)?.pinned).toBe(true);
    expect(deniedInvalidate).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(getFactById(invalidateFact.id)?.invalidAt).toBeNull();
  });

  it('denies a fact whose durable vault owner does not match the current local owner', async () => {
    const fact = seedFact({ scope: 'global' });
    getMemoryDb().runSync(
      `UPDATE memory_facts SET memory_owner_id = 'other-vault-owner' WHERE id = ?`,
      fact.id,
    );

    const result = await manage({ action: 'pin', factId: fact.id });

    expect(result).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(getFactById(fact.id)?.pinned).toBe(false);
  });
});
