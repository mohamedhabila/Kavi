jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/database';
import { memoryRememberArgs, memoryRememberExecution } from '../../helpers/memoryRememberExecution';
import { executeMemoryRemember } from '../../../src/services/memory/memoryTools';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { hasSameSourceExplicitMemoryAuthority } from '../../../src/services/memory/sameSourceFactAuthority';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

describe('same-source fact authority', () => {
  it('recognizes only an exact explicit memory-tool contribution source', () => {
    const userMessageText = 'مدة المراجعة الحالية هي ٤٥ دقيقة';
    expect(
      executeMemoryRemember(
        memoryRememberArgs({
          userMessageText,
          subjectRef: { kind: 'self' },
          predicate: 'مدة المراجعة',
          value: '٤٥ دقيقة',
          scope: 'global',
        }),
        memoryRememberExecution({
          memoryConversationId: 'memory-root',
          sourceThreadId: 'thread-current',
          userMessageId: 'user-current',
          userMessageText,
          executionRunId: 'run-current',
          toolCallId: 'remember-current',
          claimedAt: 100,
        }),
      ),
    ).toMatchObject({ ok: true });

    expect(
      hasSameSourceExplicitMemoryAuthority({
        sourceMessageId: 'user-current',
      }),
    ).toBe(true);
    expect(
      hasSameSourceExplicitMemoryAuthority({
        sourceMessageId: 'user-other',
      }),
    ).toBe(false);
  });

  it('fails closed on malformed source authority identities', () => {
    expect(() =>
      hasSameSourceExplicitMemoryAuthority({
        sourceMessageId: ' user-current',
      }),
    ).toThrow('memory_same_source_authority_message_invalid');
  });
});
