jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import { inspectExecutionRunEffectBarrier } from '../../src/services/executionJournal/executionRunEffectBarrier';
import {
  dispatchAuthorizedToolEffect,
  type AuthorizedToolEffectDispatchInput,
} from '../../src/services/executionJournal/toolEffectDispatchLifecycle';
import { completedToolOutcome, type ToolRuntimeOutcome } from '../../src/types/toolRuntimeOutcome';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests(): void;
};

function verifiedWriteResult(path: string): ToolRuntimeOutcome {
  return completedToolOutcome(
    JSON.stringify({
      status: 'written',
      path,
      size: 4,
      sha256: 'a'.repeat(64),
    }),
  );
}

function effectInput(params: {
  toolCallId: string;
  execute: () => Promise<ToolRuntimeOutcome>;
  conversationId?: string;
  executionRunId: string;
  permissionGranted?: () => boolean;
}): AuthorizedToolEffectDispatchInput {
  const path = `private/${params.toolCallId}.md`;
  return {
    conversationId: params.conversationId ?? 'conversation-1',
    toolCallId: params.toolCallId,
    toolName: 'write_file',
    argumentsText: JSON.stringify({ path, content: 'done' }),
    context: {
      executionRunId: params.executionRunId,
      agentRunId: 'optional-agent-run',
      model: 'model-1',
    },
    approvalState: 'granted',
    authority: {
      approvalGranted: () => true,
      permissionGranted: params.permissionGranted ?? (() => true),
      controlGranted: () => true,
    },
    execute: params.execute,
  };
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

describe('execution-run effect ambiguity barrier', () => {
  it('fails closed before dispatch when the code-owned execution identity is absent', async () => {
    const execute = jest.fn(async () => verifiedWriteResult('private/missing.md'));

    await expect(
      dispatchAuthorizedToolEffect({
        ...effectInput({
          toolCallId: 'missing-id',
          executionRunId: 'execution-run-placeholder',
          execute,
        }),
        context: { agentRunId: 'optional-agent-run' },
      } as unknown as AuthorizedToolEffectDispatchInput),
    ).resolves.toMatchObject({ kind: 'blocked' });

    expect(execute).not.toHaveBeenCalled();
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM execution_runs',
      ),
    ).toEqual({ count: 0 });
  });

  it('blocks a new tool-call retry after an ambiguous effect in the same execution', async () => {
    const firstExecutor = jest.fn(async () => {
      throw new Error('transport lost after the mutation may have applied');
    });
    const retryExecutor = jest.fn(async () => verifiedWriteResult('private/retry.md'));

    await expect(
      dispatchAuthorizedToolEffect(
        effectInput({
          toolCallId: 'first-effect',
          executionRunId: 'execution-run-1',
          execute: firstExecutor,
        }),
        { now: () => 100 },
      ),
    ).resolves.toMatchObject({ kind: 'executed', requiresReconciliation: true });

    await expect(
      dispatchAuthorizedToolEffect(
        effectInput({
          toolCallId: 'adversarial-new-id',
          executionRunId: 'execution-run-1',
          execute: retryExecutor,
        }),
        { now: () => 101 },
      ),
    ).resolves.toMatchObject({ kind: 'reconciliation_required' });
    expect(retryExecutor).not.toHaveBeenCalled();
  });

  it('serializes parallel effect calls so a later call cannot outrun ambiguity', async () => {
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstDidStart = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const firstExecutor = jest.fn(async () => {
      firstStarted();
      await firstCanFinish;
      throw new Error('unknown external outcome');
    });
    const secondExecutor = jest.fn(async () => verifiedWriteResult('private/second.md'));

    const first = dispatchAuthorizedToolEffect(
      effectInput({
        toolCallId: 'parallel-first',
        executionRunId: 'execution-run-parallel',
        execute: firstExecutor,
      }),
      { now: () => 100 },
    );
    await firstDidStart;
    const second = dispatchAuthorizedToolEffect(
      effectInput({
        toolCallId: 'parallel-second',
        executionRunId: 'execution-run-parallel',
        execute: secondExecutor,
      }),
      { now: () => 101 },
    );
    await Promise.resolve();
    expect(secondExecutor).not.toHaveBeenCalled();
    releaseFirst();

    await expect(first).resolves.toMatchObject({ requiresReconciliation: true });
    await expect(second).resolves.toMatchObject({ kind: 'reconciliation_required' });
    expect(secondExecutor).not.toHaveBeenCalled();
  });

  it('rebuilds the barrier from durable journal state after the database is reopened', async () => {
    await dispatchAuthorizedToolEffect(
      effectInput({
        toolCallId: 'before-restart',
        executionRunId: 'execution-run-restart',
        execute: async () => {
          throw new Error('ambiguous before restart');
        },
      }),
      { now: () => 100 },
    );
    closeExecutionJournalDb();
    const afterRestartExecutor = jest.fn(async () => verifiedWriteResult('private/after.md'));

    await expect(
      dispatchAuthorizedToolEffect(
        effectInput({
          toolCallId: 'after-restart',
          executionRunId: 'execution-run-restart',
          execute: afterRestartExecutor,
        }),
        { now: () => 101 },
      ),
    ).resolves.toMatchObject({ kind: 'reconciliation_required' });
    expect(afterRestartExecutor).not.toHaveBeenCalled();
  });

  it.each([
    ['verified', async () => verifiedWriteResult('private/terminal-verified.md'), () => true],
    ['failed', async () => verifiedWriteResult('private/terminal-failed.md'), () => true],
    ['cancelled', async () => verifiedWriteResult('private/terminal-cancelled.md'), () => false],
  ] as const)(
    'allows a later effect after a %s terminal effect',
    async (_status, execute, permission) => {
      await dispatchAuthorizedToolEffect(
        effectInput({
          toolCallId: `terminal-${_status}`,
          executionRunId: `execution-run-${_status}`,
          execute,
          permissionGranted: permission,
        }),
        { now: () => 100 },
      );
      if (_status === 'failed') {
        getExecutionJournalDb().runSync(
          `UPDATE execution_effects SET status = 'failed' WHERE tool_call_id = ?`,
          `terminal-${_status}`,
        );
      }
      const nextExecutor = jest.fn(async () => verifiedWriteResult(`private/next-${_status}.md`));

      await expect(
        dispatchAuthorizedToolEffect(
          effectInput({
            toolCallId: `next-${_status}`,
            executionRunId: `execution-run-${_status}`,
            execute: nextExecutor,
          }),
          { now: () => 101 },
        ),
      ).resolves.toMatchObject({ kind: 'executed' });
      expect(nextExecutor).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['started', 'applied', 'ambiguous'] as const)(
    'treats durable %s state as a reconciliation barrier',
    async (status) => {
      await dispatchAuthorizedToolEffect(
        effectInput({
          toolCallId: `seed-${status}`,
          executionRunId: `execution-run-${status}`,
          execute: async () => verifiedWriteResult(`private/seed-${status}.md`),
        }),
        { now: () => 100 },
      );
      if (status === 'started') {
        getExecutionJournalDb().runSync(
          `UPDATE execution_effects
           SET status = 'started', completed_at = NULL
           WHERE tool_call_id = ?`,
          `seed-${status}`,
        );
      } else {
        getExecutionJournalDb().runSync(
          `UPDATE execution_effects SET status = ? WHERE tool_call_id = ?`,
          status,
          `seed-${status}`,
        );
      }

      expect(inspectExecutionRunEffectBarrier('conversation-1', `execution-run-${status}`)).toEqual(
        { kind: 'reconciliation_required', blockingStatus: status },
      );
    },
  );

  it('rejects reuse of one execution identity across conversations', async () => {
    await dispatchAuthorizedToolEffect(
      effectInput({
        toolCallId: 'conversation-one',
        executionRunId: 'execution-run-conflict',
        execute: async () => verifiedWriteResult('private/one.md'),
      }),
      { now: () => 100 },
    );
    const conflictingExecutor = jest.fn(async () => verifiedWriteResult('private/two.md'));

    await expect(
      dispatchAuthorizedToolEffect(
        effectInput({
          conversationId: 'conversation-2',
          toolCallId: 'conversation-two',
          executionRunId: 'execution-run-conflict',
          execute: conflictingExecutor,
        }),
        { now: () => 101 },
      ),
    ).resolves.toMatchObject({ kind: 'blocked' });
    expect(conflictingExecutor).not.toHaveBeenCalled();
  });

  it('stores the execution identity as the durable journal task owner', async () => {
    await dispatchAuthorizedToolEffect(
      effectInput({
        toolCallId: 'owner-check',
        executionRunId: 'execution-run-owner',
        execute: async () => verifiedWriteResult('private/owner.md'),
      }),
      { now: () => 100 },
    );

    expect(
      getExecutionJournalDb().getFirstSync<{ task_id: string }>(
        'SELECT task_id FROM execution_runs LIMIT 1',
      ),
    ).toEqual({ task_id: 'execution-run-owner' });
  });
});
