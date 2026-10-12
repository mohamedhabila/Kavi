jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

let mockPolicyEpoch = 3;
let mockMemoryOn = true;
let mockAuthoritySnapshot: unknown = Object.freeze({ owner: 'vault-1' });

jest.mock('../../src/services/memory/policy', () => ({
  ...jest.requireActual('../../src/services/memory/policy'),
  getMemoryPolicyEpoch: () => mockPolicyEpoch,
  captureMemoryReadEpoch: () => (mockMemoryOn ? mockPolicyEpoch : null),
}));

jest.mock('../../src/services/memory/memoryAuthority', () => ({
  ...jest.requireActual('../../src/services/memory/memoryAuthority'),
  captureMemoryAuthoritySnapshot: () => mockAuthoritySnapshot,
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
  mockAuthoritySnapshot = Object.freeze({ owner: 'vault-1' });
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
    expect(read.authoritySnapshot).toBe(mockAuthoritySnapshot);
    expect(read.section?.text).toContain('Sara (the user’s sister) lives in Porto');
    expect(read.section?.text).toContain('Plan my Porto trip to visit Sara');
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

  it('reports memory unavailable when its authority cannot be read', () => {
    mockAuthoritySnapshot = null;

    expect(readSessionMemory('conv-1', [userMessage('u1', 'Sara in Porto?', 1)])).toEqual({
      status: 'unavailable',
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
