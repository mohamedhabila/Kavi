jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import { dispatchAuthorizedToolEffect } from '../../src/services/executionJournal/toolEffectDispatchLifecycle';
import type { AuthorizedToolEffectDispatchInput } from '../../src/services/executionJournal/toolEffectDispatchLifecycle';
import { readToolEffectRestartDisposition } from '../../src/services/executionJournal/toolEffectRestartDisposition';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests(): void;
};

function verifiedWriteResult(): string {
  return JSON.stringify({
    status: 'written',
    path: 'private/plan.md',
    size: 4,
    sha256: 'a'.repeat(64),
  });
}

function input(
  execute: () => Promise<string>,
  overrides: Partial<AuthorizedToolEffectDispatchInput> = {},
): AuthorizedToolEffectDispatchInput {
  return {
    conversationId: 'conversation-1',
    toolCallId: 'tool-call-1',
    toolName: 'write_file',
    argumentsText: JSON.stringify({ path: 'private/plan.md', content: 'done' }),
    context: { agentRunId: 'agent-run-1', model: 'model-1' },
    approvalState: 'granted',
    authority: {
      approvalGranted: () => true,
      controlGranted: () => true,
      permissionGranted: () => true,
    },
    execute,
    ...overrides,
  };
}

function read() {
  return readToolEffectRestartDisposition({
    conversationId: 'conversation-1',
    taskId: 'agent-run-1',
    toolCallId: 'tool-call-1',
    toolName: 'write_file',
    argumentsText: JSON.stringify({ path: 'private/plan.md', content: 'done' }),
  });
}

beforeEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
  sqliteMock.__resetExpoSqliteForTests();
});

afterEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
});

describe('durable tool effect restart disposition', () => {
  it('returns not dispatched when no exact effect generation exists', () => {
    getExecutionJournalDb();

    expect(read()).toEqual({ kind: 'not_dispatched' });
  });

  it('recognizes an exact verified terminal effect without retaining its payload', async () => {
    await dispatchAuthorizedToolEffect(
      input(async () => verifiedWriteResult()),
      {
        now: () => 100,
      },
    );

    expect(read()).toEqual({ kind: 'verified', observedAt: 100 });
  });

  it('requires reconciliation when dispatch started but its effect stayed ambiguous', async () => {
    await dispatchAuthorizedToolEffect(
      input(async () => {
        throw new Error('transport lost after dispatch');
      }),
      { now: () => 100 },
    );

    expect(read()).toEqual({
      kind: 'reconciliation_required',
      observedAt: 100,
      reason: 'ambiguous_effect',
    });
  });

  it('fails closed when multiple durable generations claim one tool-call identity', async () => {
    await dispatchAuthorizedToolEffect(
      input(async () => verifiedWriteResult()),
      {
        now: () => 100,
      },
    );
    await dispatchAuthorizedToolEffect(
      input(async () => verifiedWriteResult(), {
        argumentsText: JSON.stringify({ path: 'private/other.md', content: 'done' }),
      }),
      { now: () => 101 },
    );

    expect(read()).toEqual({
      kind: 'reconciliation_required',
      observedAt: null,
      reason: 'journal_conflict',
    });
  });

  it('does not cross conversation or task ownership', async () => {
    await dispatchAuthorizedToolEffect(
      input(async () => verifiedWriteResult()),
      {
        now: () => 100,
      },
    );

    expect(
      readToolEffectRestartDisposition({
        conversationId: 'conversation-1',
        taskId: 'agent-run-other',
        toolCallId: 'tool-call-1',
        toolName: 'write_file',
        argumentsText: JSON.stringify({ path: 'private/plan.md', content: 'done' }),
      }),
    ).toEqual({ kind: 'not_dispatched' });
  });

  it('reports an unavailable journal instead of assuming no effect', () => {
    expect(
      readToolEffectRestartDisposition(
        {
          conversationId: 'conversation-1',
          taskId: 'agent-run-1',
          toolCallId: 'tool-call-1',
          toolName: 'write_file',
          argumentsText: JSON.stringify({ path: 'private/plan.md', content: 'done' }),
        },
        {
          getDatabase: () => {
            throw new Error('database unavailable');
          },
        },
      ),
    ).toEqual({
      kind: 'reconciliation_required',
      observedAt: null,
      reason: 'journal_unavailable',
    });
  });

  it('does not consult the effect journal for a code-owned effect-free invocation', () => {
    const getDatabase = jest.fn(() => {
      throw new Error('must not be called');
    });

    expect(
      readToolEffectRestartDisposition(
        {
          conversationId: 'conversation-1',
          taskId: 'agent-run-1',
          toolCallId: 'tool-call-read-1',
          toolName: 'web_fetch',
          argumentsText: JSON.stringify({ url: 'https://example.invalid' }),
        },
        { getDatabase },
      ),
    ).toEqual({ kind: 'not_dispatched' });
    expect(getDatabase).not.toHaveBeenCalled();
  });
});
