jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

let mockPolicyEpoch = 3;
let mockMemoryOn = true;

jest.mock('../../src/services/memory/policy', () => ({
  ...jest.requireActual('../../src/services/memory/policy'),
  getMemoryPolicyEpoch: () => mockPolicyEpoch,
  captureMemoryReadEpoch: () => (mockMemoryOn ? mockPolicyEpoch : null),
}));

import type { Message } from '../../src/types/message';
import {
  isSessionMemoryReadCurrent,
  readSessionMemory,
} from '../../src/services/memory/memoryAccessGateway';
import { closeMemoryDb } from '../../src/services/memory/database';
import { resetMemoryCoreSchemaCacheForTests } from '../../src/services/memory/core/memorySchema';
import { addMemoryItem } from '../../src/services/memory/core/memoryItemsStore';
import { indexMemoryTurn } from '../../src/services/memory/core/memoryTurnsStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function userMessage(id: string, content: string, timestamp: number): Message {
  return { id, role: 'user', content, timestamp };
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetMemoryCoreSchemaCacheForTests();
  mockPolicyEpoch = 3;
  mockMemoryOn = true;
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

    expect(read).toMatchObject({ status: 'read', policyEpoch: 3 });
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
    mockMemoryOn = false;
    addMemoryItem({
      text: 'Sara (the user’s sister) lives in Porto',
      conversationId: 'conv-1',
      now: 0,
    });

    expect(readSessionMemory('conv-1', [userMessage('u1', 'Sara in Porto?', 1)])).toEqual({
      status: 'off',
      policyEpoch: 3,
    });
  });

  it('stays current until memory is turned on or off', () => {
    const read = readSessionMemory('conv-1', [userMessage('u1', 'Hello', 1)]);
    expect(isSessionMemoryReadCurrent(read)).toBe(true);

    mockPolicyEpoch = 4;
    expect(isSessionMemoryReadCurrent(read)).toBe(false);
  });
});
