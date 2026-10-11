jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/database';
import {
  issueExplicitMemoryRecallGrant,
  resetExplicitMemoryRecallGrantStateForTests,
} from '../../../src/services/memory/explicitMemoryRecallGrant';
import { resolveLocalMemoryAccessScope } from '../../../src/services/memory/memoryScopeStore';

// A sensitive fact is shown only for what the person asks for in their current message:
// the grant needs the words of that message that ask for the relation, in any language.

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetExplicitMemoryRecallGrantStateForTests();
});

afterEach(() => {
  closeMemoryDb();
});

describe('issueExplicitMemoryRecallGrant', () => {
  const identity = {
    currentUserMessageId: 'user-message-2',
    executionRunId: 'execution-run-2',
    toolCallId: 'tool-call-grant',
    agentRunId: null,
    scope: resolveLocalMemoryAccessScope({
      memoryConversationId: 'conversation-1',
      sourceThreadId: 'thread-1',
      personaId: 'default',
      taskId: null,
    }),
  };

  it('needs no subject quote when the person asks about themselves, in any language', () => {
    const issued = issueExplicitMemoryRecallGrant({
      ...identity,
      currentUserMessageText: '请显示我保存的健康资料',
      relationQuote: '健康资料',
      requestedSubject: 'user',
      requestedPredicate: 'health_record',
    });

    expect(issued).toHaveProperty('grant');
  });

  it.each([
    ['subject_missing', { requestedSubject: '' }],
    ['predicate_missing', { requestedPredicate: undefined }],
    ['relation_quote_missing', { relationQuote: ' padded ' }],
    ['relation_quote_not_in_message', { relationQuote: 'blood type' }],
  ])('reports %s', (failure, override) => {
    expect(
      issueExplicitMemoryRecallGrant({
        ...identity,
        currentUserMessageText: '请显示我保存的健康资料',
        relationQuote: '健康资料',
        requestedSubject: 'user',
        requestedPredicate: 'health_record',
        ...override,
      }),
    ).toEqual({ failure });
  });

  it('reports a typed evidence object that does not match its contract', () => {
    expect(
      issueExplicitMemoryRecallGrant({
        ...identity,
        currentUserMessageText: 'Show my health record',
        explicitRequestEvidence: { version: '1' },
      }),
    ).toEqual({ failure: 'evidence_malformed' });
  });
});
