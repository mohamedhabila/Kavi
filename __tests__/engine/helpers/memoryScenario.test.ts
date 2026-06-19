jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { ensureDefaultBlocks } from '../../../src/services/memory/blocks';
import { ensureFactSchema } from '../../../src/services/memory/schema';
import { recordCompletedTurnForMemory } from '../../../src/services/memory/lifecycle';
import { readMemoryScenarioWorkingBlock, resetMemoryScenario } from './memoryScenario';
import type { Message } from '../../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

describe('memoryScenario helper', () => {
  beforeEach(() => {
    resetMemoryScenario(() => expoSqlite.__resetExpoSqliteForTests());
    ensureFactSchema();
    ensureDefaultBlocks();
  });

  it('reads working memory after a completed turn is recorded', async () => {
    const conversationId = 'conv-memory-scenario';
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'Remember my flight on Friday', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'I will keep that in mind.', timestamp: 2 },
    ];

    await recordCompletedTurnForMemory({
      conversationId,
      messages,
      completedMessageId: 'a1',
    });

    const focus = await readMemoryScenarioWorkingBlock(conversationId, 'active_focus');
    expect(typeof focus === 'string' || focus === null).toBe(true);
  });
});
