jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { listFacts } from '../../src/services/memory/facts/queries';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { closeMemoryDb } from '../../src/services/memory/database';
import { executeMemoryRemember } from '../../src/services/memory/memoryTools';
import { memoryRememberArgs, memoryRememberExecution } from '../helpers/memoryRememberExecution';

// After the person steers a running request with another message, the run's current user
// message is the steer. A fact the person stated in the request itself must still be
// rememberable, grounded in the request it was stated in.

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const REQUEST = { id: 'request', text: 'Plan dinner. My sister Amira is vegetarian.' };
const STEER_TEXT = 'Book it for Friday.';

function rememberFromSteeredTurn(value: string, earlier = [REQUEST]) {
  return executeMemoryRemember(
    memoryRememberArgs({
      userMessageText: STEER_TEXT,
      subjectRef: { kind: 'named', label: 'Amira' },
      subjectType: 'person',
      predicate: 'diet',
      value,
    }),
    memoryRememberExecution({
      memoryConversationId: 'conversation-1',
      sourceThreadId: 'thread-1',
      userMessageId: 'steer',
      userMessageText: STEER_TEXT,
      earlierUserMessages: earlier,
      executionRunId: 'steered-run',
      toolCallId: 'remember-call',
      claimedAt: 200,
    }),
  );
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

describe('memory_remember in a steered turn', () => {
  it('remembers a fact the request stated, grounded in the request', () => {
    expect(rememberFromSteeredTurn('vegetarian')).toMatchObject({ ok: true, status: 'created' });

    expect(
      listFacts({ includeInvalidated: true }).filter((fact) => fact.memoryKind === 'semantic_fact'),
    ).toEqual([
      expect.objectContaining({
        predicate: 'diet',
        objectText: 'vegetarian',
        sourceMessageId: 'request',
      }),
    ]);
  });

  it('still refuses a value no message of the turn states', () => {
    expect(rememberFromSteeredTurn('vegan')).toMatchObject({
      ok: false,
      code: 'grounding_required',
    });
    expect(listFacts({ includeInvalidated: true })).toEqual([]);
  });

  it('cannot quote the request when the turn did not carry it', () => {
    expect(rememberFromSteeredTurn('vegetarian', [])).toMatchObject({
      ok: false,
      code: 'grounding_required',
    });
  });
});
