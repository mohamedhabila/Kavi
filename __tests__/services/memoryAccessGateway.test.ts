jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import type { Message } from '../../src/types/message';
import {
  isSessionMemoryReadCurrent,
  readSessionMemory,
} from '../../src/services/memory/memoryAccessGateway';
import { closeMemoryDb } from '../../src/services/memory/database';
import { resetMemoryCoreSchemaCacheForTests } from '../../src/services/memory/core/memorySchema';
import { addMemoryItem } from '../../src/services/memory/core/memoryItemsStore';
import { indexMemoryTurn } from '../../src/services/memory/core/memoryTurnsStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function userMessage(id: string, content: string, timestamp: number): Message {
  return { id, role: 'user', content, timestamp };
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetMemoryCoreSchemaCacheForTests();
  useSettingsStore.setState({ disableLongTermMemory: false });
});

afterAll(() => {
  closeMemoryDb();
});

describe('session memory read', () => {
  it('reads the memories and earlier conversations the latest user message relates to', () => {
    addMemoryItem({
      text: 'Sara (the user’s sister) lives in Porto',
      conversationId: 'conv-1',
      now: 0,
    });
    indexMemoryTurn({
      conversationId: 'conv-0',
      userMessageId: 'old-u1',
      userText: 'Plan my Porto trip to visit Sara',
      replyText: 'Day one: Ribeira.',
      at: 0,
    });

    const read = readSessionMemory('conv-1', [
      userMessage('u1', 'Hello there', 1),
      { id: 'a1', role: 'assistant', content: 'Hi!', timestamp: 2 },
      userMessage('u2', 'When should I visit Sara in Porto?', 3),
    ]);

    expect(read).toMatchObject({ status: 'read' });
    if (read.status !== 'read') throw new Error('memory was not read');
    expect(read.section?.text).toContain('Sara (the user’s sister) lives in Porto');
    expect(read.section?.text).toContain('Plan my Porto trip to visit Sara');
  });

  it('recalls this conversation’s earlier rounds only once the request no longer carries them', () => {
    indexMemoryTurn({
      conversationId: 'conv-1',
      userMessageId: 'u-archived',
      userText: 'The cabin entrance is the blue door on the left',
      replyText: 'Noted.',
      at: 0,
    });
    indexMemoryTurn({
      conversationId: 'conv-1',
      userMessageId: 'u-carried',
      userText: 'Is the cabin entrance the blue door?',
      replyText: 'Yes, on the left.',
      at: 1,
    });

    const read = readSessionMemory('conv-1', [
      userMessage('u-carried', 'Is the cabin entrance the blue door?', 2),
      { id: 'a-carried', role: 'assistant', content: 'Yes, on the left.', timestamp: 3 },
      userMessage('u-latest', 'Which cabin entrance do I use?', 4),
    ]);

    if (read.status !== 'read') throw new Error('memory was not read');
    expect(read.section?.turnIds).toEqual(['u-archived']);
  });

  it('reads nothing while memory is off', () => {
    useSettingsStore.setState({ disableLongTermMemory: true });
    addMemoryItem({
      text: 'Sara (the user’s sister) lives in Porto',
      conversationId: 'conv-1',
      now: 0,
    });

    expect(readSessionMemory('conv-1', [userMessage('u1', 'Sara in Porto?', 1)])).toEqual({
      status: 'off',
    });
  });

  it('stays current while memory is as on or off as it was when read', () => {
    const messages = [userMessage('u1', 'Hello', 1)];
    const readWhileOn = readSessionMemory('conv-1', messages);
    expect(isSessionMemoryReadCurrent(readWhileOn, messages)).toBe(true);

    useSettingsStore.setState({ disableLongTermMemory: true });
    expect(isSessionMemoryReadCurrent(readWhileOn, messages)).toBe(false);
    const readWhileOff = readSessionMemory('conv-1', messages);
    expect(isSessionMemoryReadCurrent(readWhileOff, messages)).toBe(true);

    useSettingsStore.setState({ disableLongTermMemory: false });
    expect(isSessionMemoryReadCurrent(readWhileOff, messages)).toBe(false);
    expect(isSessionMemoryReadCurrent({ status: 'unavailable' }, messages)).toBe(true);
  });

  // A run read memory once, leaving out every round it carried. When compaction then
  // replaced some of those rounds with a summary, the run kept the old read: the replaced
  // rounds were neither in its messages nor recallable from memory.
  it('is read again once compaction replaced a round it left out', () => {
    indexMemoryTurn({
      conversationId: 'conv-1',
      userMessageId: 'u-old',
      userText: 'The cabin entrance is the blue door on the left',
      replyText: 'Noted.',
      at: 0,
    });
    const before = [
      userMessage('u-old', 'The cabin entrance is the blue door on the left', 1),
      { id: 'a-old', role: 'assistant' as const, content: 'Noted.', timestamp: 2 },
      userMessage('u-latest', 'Which cabin entrance do I use?', 3),
    ];
    const read = readSessionMemory('conv-1', before);
    expect(isSessionMemoryReadCurrent(read, before)).toBe(true);
    if (read.status !== 'read') throw new Error('memory was not read');
    expect(read.section?.text ?? '').not.toContain('blue door');

    const compacted = [
      { id: 'summary', role: 'system' as const, content: 'Earlier: a cabin trip.', timestamp: 2 },
      userMessage('u-latest', 'Which cabin entrance do I use?', 3),
    ];
    expect(isSessionMemoryReadCurrent(read, compacted)).toBe(false);
    const reread = readSessionMemory('conv-1', compacted);
    if (reread.status !== 'read') throw new Error('memory was not read');
    expect(reread.section?.text).toContain('blue door');
  });
});
