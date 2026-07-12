jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { executeToolInner as executeTool } from '../../src/engine/tools/toolDispatchRouter';
import { closeMemoryDb } from '../../src/services/memory/database';
import { listFacts } from '../../src/services/memory/facts/queries';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { useChatStore } from '../../src/store/useChatStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const THREAD_ID = 'prior-correction-thread';
const MEMORY_CONVERSATION_ID = 'prior-correction-root';

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({ disableLongTermMemory: false });
  useChatStore.setState({ conversations: [] } as never);
});

afterEach(() => {
  closeMemoryDb();
  useChatStore.setState({ conversations: [] } as never);
});

async function remember(
  args: Record<string, unknown>,
  currentUserMessage: { id: string; text: string },
): Promise<Record<string, any>> {
  return JSON.parse(
    await executeTool('memory_remember', JSON.stringify(args), THREAD_ID, {
      memoryConversationId: MEMORY_CONVERSATION_ID,
      currentUserMessage,
    }),
  ) as Record<string, any>;
}

it('derives prior user identity from chat state and reuses the grounded predicate', async () => {
  const prior = {
    id: 'user-engine-prior-old',
    text: 'I usually keep architecture reviews to 30 minutes.',
  };
  const current = {
    id: 'user-engine-prior-new',
    text: 'Actually, make my usual architecture-review length 45 minutes, not 30 minutes.',
  };
  const first = await remember(
    {
      subject: 'user',
      subjectType: 'self',
      predicate: 'usual architecture review duration',
      value: '30 minutes',
      scope: 'global',
    },
    prior,
  );
  useChatStore.setState({
    conversations: [
      {
        id: THREAD_ID,
        title: 'Memory grounding test',
        messages: [
          { id: prior.id, role: 'user', content: prior.text, timestamp: 1 },
          { id: current.id, role: 'user', content: current.text, timestamp: 2 },
        ],
        providerId: 'test-provider',
        systemPrompt: '',
        createdAt: 1,
        updatedAt: 2,
      },
    ],
  } as never);
  const corrected = await remember(
    {
      subject: 'self:architecture-reviews',
      subjectType: 'self',
      predicate: 'architecture_review_default_duration_minutes',
      value: '45 minutes',
      scope: 'global',
    },
    current,
  );

  expect(first.ok).toBe(true);
  expect(corrected).toMatchObject({
    ok: true,
    fact: {
      subject: 'user',
      predicate: 'usual architecture review duration',
      value: '45 minutes',
    },
    superseded: [{ id: first.fact.id, invalidAt: expect.any(Number) }],
  });
  expect(listFacts({ predicate: 'architecture_review_default_duration_minutes' })).toEqual([]);
});
