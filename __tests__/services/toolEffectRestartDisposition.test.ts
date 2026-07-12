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
import {
  buildToolEffectRestartDispositionResolver,
  readToolEffectRestartDisposition,
} from '../../src/services/executionJournal/toolEffectRestartDisposition';

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
    context: {
      agentRunId: 'agent-run-1',
      executionRunId: 'execution-run-1',
      model: 'model-1',
    },
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
    executionRunId: 'execution-run-1',
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
  it('returns not dispatched when no exact effect generation exists', async () => {
    getExecutionJournalDb();

    await expect(read()).resolves.toEqual({ kind: 'not_dispatched' });
  });

  it('recognizes an exact verified terminal effect without retaining its payload', async () => {
    await dispatchAuthorizedToolEffect(
      input(async () => verifiedWriteResult()),
      {
        now: () => 100,
      },
    );

    await expect(read()).resolves.toEqual({ kind: 'verified', observedAt: 100 });
  });

  it('requires reconciliation when dispatch started but its effect stayed ambiguous', async () => {
    await dispatchAuthorizedToolEffect(
      input(async () => {
        throw new Error('transport lost after dispatch');
      }),
      { now: () => 100 },
    );

    await expect(read()).resolves.toEqual({
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

    await expect(read()).resolves.toEqual({
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

    await expect(
      readToolEffectRestartDisposition({
        conversationId: 'conversation-1',
        executionRunId: 'execution-run-other',
        toolCallId: 'tool-call-1',
        toolName: 'write_file',
        argumentsText: JSON.stringify({ path: 'private/plan.md', content: 'done' }),
      }),
    ).resolves.toEqual({ kind: 'not_dispatched' });
  });

  it.each([
    {
      name: 'tool name',
      toolName: 'web_fetch',
      argumentsText: JSON.stringify({ url: 'https://example.invalid' }),
    },
    {
      name: 'canonical request',
      toolName: 'write_file',
      argumentsText: JSON.stringify({ path: 'private/other.md', content: 'done' }),
    },
  ])('rejects one verified row when its $name digest differs', async (mismatch) => {
    await dispatchAuthorizedToolEffect(
      input(async () => verifiedWriteResult()),
      {
        now: () => 100,
      },
    );

    await expect(
      readToolEffectRestartDisposition({
        conversationId: 'conversation-1',
        executionRunId: 'execution-run-1',
        toolCallId: 'tool-call-1',
        toolName: mismatch.toolName,
        argumentsText: mismatch.argumentsText,
      }),
    ).resolves.toEqual({
      kind: 'reconciliation_required',
      observedAt: null,
      reason: 'journal_conflict',
    });
  });

  it('matches canonically equivalent JSON arguments', async () => {
    await dispatchAuthorizedToolEffect(
      input(async () => verifiedWriteResult()),
      {
        now: () => 100,
      },
    );

    await expect(
      readToolEffectRestartDisposition({
        conversationId: 'conversation-1',
        executionRunId: 'execution-run-1',
        toolCallId: 'tool-call-1',
        toolName: 'write_file',
        argumentsText: JSON.stringify({ content: 'done', path: 'private/plan.md' }),
      }),
    ).resolves.toEqual({ kind: 'verified', observedAt: 100 });
  });

  it('prebuilds a bounded synchronous resolver and fails closed outside its input set', async () => {
    const exactInput = {
      conversationId: 'conversation-1',
      executionRunId: 'execution-run-1',
      toolCallId: 'tool-call-1',
      toolName: 'write_file',
      argumentsText: JSON.stringify({ path: 'private/plan.md', content: 'done' }),
    };
    const resolve = await buildToolEffectRestartDispositionResolver([exactInput], async () => ({
      kind: 'verified',
      observedAt: 100,
    }));

    expect(resolve(exactInput)).toEqual({ kind: 'verified', observedAt: 100 });
    expect(resolve({ ...exactInput, argumentsText: '{}' })).toEqual({
      kind: 'reconciliation_required',
      observedAt: null,
      reason: 'journal_conflict',
    });
  });

  it('reports an unavailable journal instead of assuming no effect', async () => {
    await expect(
      readToolEffectRestartDisposition(
        {
          conversationId: 'conversation-1',
          executionRunId: 'execution-run-1',
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
    ).resolves.toEqual({
      kind: 'reconciliation_required',
      observedAt: null,
      reason: 'journal_unavailable',
    });
  });

  it('reports no dispatch for an effect-free invocation with no journal identity', async () => {
    getExecutionJournalDb();

    await expect(
      readToolEffectRestartDisposition({
        conversationId: 'conversation-1',
        executionRunId: 'execution-run-1',
        toolCallId: 'tool-call-read-1',
        toolName: 'web_fetch',
        argumentsText: JSON.stringify({ url: 'https://example.invalid' }),
      }),
    ).resolves.toEqual({ kind: 'not_dispatched' });
  });
});
