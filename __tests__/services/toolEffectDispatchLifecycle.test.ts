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

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests(): void;
};

function authority(overrides: Partial<AuthorizedToolEffectDispatchInput['authority']> = {}) {
  return {
    approvalGranted: () => true,
    permissionGranted: () => true,
    controlGranted: () => true,
    ...overrides,
  };
}

function verifiedWriteResult(): string {
  return JSON.stringify({
    status: 'written',
    path: 'private/plan.md',
    size: 4,
    sha256: 'a'.repeat(64),
  });
}

function writeInput(
  execute: () => Promise<string>,
  overrides: Partial<AuthorizedToolEffectDispatchInput> = {},
): AuthorizedToolEffectDispatchInput {
  return {
    conversationId: 'conversation-1',
    toolCallId: 'tool-call-write-1',
    toolName: 'write_file',
    argumentsText: JSON.stringify({
      path: 'private/plan.md',
      content: 'done',
      bearerToken: 'must-never-be-journaled',
    }),
    context: {
      agentRunId: 'agent-run-1',
      model: 'model-1',
      provider: {
        id: 'provider-1',
        name: 'Provider',
        kind: 'remote',
        baseUrl: 'https://provider.invalid',
        apiKey: 'must-never-be-journaled',
        model: 'model-1',
        enabled: true,
      },
    },
    approvalState: 'granted',
    authority: authority(),
    execute,
    ...overrides,
  };
}

function count(table: string): number {
  return (
    getExecutionJournalDb().getFirstSync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ${table}`,
    )?.count ?? -1
  );
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

describe('authorized durable tool effect dispatch', () => {
  it('persists and claims the exact effect before invoking the executor', async () => {
    const execute = jest.fn(async () => {
      expect(
        getExecutionJournalDb().getFirstSync<{ status: string }>(
          'SELECT status FROM execution_effects LIMIT 1',
        ),
      ).toEqual({ status: 'started' });
      return verifiedWriteResult();
    });

    const result = await dispatchAuthorizedToolEffect(writeInput(execute), { now: () => 100 });

    expect(result).toMatchObject({
      kind: 'executed',
      requiresReconciliation: false,
      executorThrew: false,
      receipt: {
        effectKind: 'artifact.write',
        effectState: 'applied',
        verificationState: 'verified',
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT r.status AS run_status, r.durability_class,
                e.status AS effect_status, e.outcome_digest
         FROM execution_runs r
         JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({
      run_status: 'succeeded',
      durability_class: 'external_durable_operation',
      effect_status: 'verified',
      outcome_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(count('execution_checkpoints')).toBe(4);
    expect(
      getExecutionJournalDb().getFirstSync<{ boundary: string; phase: string }>(
        'SELECT boundary, phase FROM execution_checkpoints ORDER BY sequence DESC LIMIT 1',
      ),
    ).toEqual({ boundary: 'terminal', phase: 'deliver' });
  });

  it('allows only one concurrent claimant to invoke the executor', async () => {
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
      return verifiedWriteResult();
    });
    const replayExecutor = jest.fn(async () => verifiedWriteResult());

    const first = dispatchAuthorizedToolEffect(writeInput(firstExecutor), { now: () => 100 });
    await firstDidStart;
    const replay = await dispatchAuthorizedToolEffect(writeInput(replayExecutor), {
      now: () => 101,
    });
    releaseFirst();

    await expect(first).resolves.toMatchObject({ kind: 'executed' });
    expect(replay).toMatchObject({ kind: 'reconciliation_required' });
    expect(firstExecutor).toHaveBeenCalledTimes(1);
    expect(replayExecutor).not.toHaveBeenCalled();
  });

  it('suppresses an exact replay after verified settlement', async () => {
    const firstExecutor = jest.fn(async () => verifiedWriteResult());
    const replayExecutor = jest.fn(async () => verifiedWriteResult());

    await expect(
      dispatchAuthorizedToolEffect(writeInput(firstExecutor), { now: () => 100 }),
    ).resolves.toMatchObject({ kind: 'executed' });
    const replay = await dispatchAuthorizedToolEffect(writeInput(replayExecutor), {
      now: () => 101,
    });

    expect(replay).toMatchObject({ kind: 'reconciliation_required' });
    expect(replay.result).toContain('do not retry automatically');
    expect(firstExecutor).toHaveBeenCalledTimes(1);
    expect(replayExecutor).not.toHaveBeenCalled();
  });

  it('records an executor throw as ambiguous instead of retryable failure', async () => {
    const execute = jest.fn(async () => {
      throw new Error('timeout after the device may have written');
    });

    const result = await dispatchAuthorizedToolEffect(writeInput(execute), { now: () => 100 });

    expect(result).toMatchObject({
      kind: 'executed',
      requiresReconciliation: true,
      executorThrew: true,
      receipt: { transportState: 'threw', effectState: 'unknown' },
    });
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT r.status AS run_status, e.status AS effect_status
         FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'ambiguous', effect_status: 'ambiguous' });
  });

  it('marks receipt construction failure after dispatch ambiguous', async () => {
    const execute = jest.fn(async () => verifiedWriteResult());
    const buildReceipt = jest.fn(async () => {
      throw new Error('hash unavailable');
    });

    const result = await dispatchAuthorizedToolEffect(writeInput(execute), {
      now: () => 100,
      buildReceipt,
    });

    expect(result).toMatchObject({ kind: 'reconciliation_required' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      getExecutionJournalDb().getFirstSync<{ status: string }>(
        'SELECT status FROM execution_effects LIMIT 1',
      ),
    ).toEqual({ status: 'ambiguous' });
  });

  it('fails closed before dispatch when the journal is unavailable', async () => {
    const execute = jest.fn(async () => verifiedWriteResult());

    const result = await dispatchAuthorizedToolEffect(writeInput(execute), {
      now: () => 100,
      getDatabase: () => {
        throw new Error('database unavailable');
      },
    });

    expect(result).toMatchObject({ kind: 'blocked' });
    expect(result.result).toContain('was not executed');
    expect(execute).not.toHaveBeenCalled();
  });

  it('revalidates permission after preparation and before the claim', async () => {
    const execute = jest.fn(async () => verifiedWriteResult());
    getExecutionJournalDb().execSync(
      `CREATE TRIGGER enforce_effect_cancel_transition
       BEFORE UPDATE OF status ON execution_effects
       WHEN NEW.status = 'cancelled' AND OLD.status != 'started'
       BEGIN
         SELECT RAISE(ABORT, 'cancel_requires_started');
       END`,
    );
    const result = await dispatchAuthorizedToolEffect(
      writeInput(execute, {
        authority: authority({ permissionGranted: () => false }),
      }),
      { now: () => 100 },
    );

    expect(result).toMatchObject({ kind: 'blocked' });
    expect(execute).not.toHaveBeenCalled();
    expect(
      getExecutionJournalDb().getFirstSync<{ run_status: string; effect_status: string }>(
        `SELECT r.status AS run_status, e.status AS effect_status
         FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'cancelled', effect_status: 'cancelled' });
    expect(
      getExecutionJournalDb().getFirstSync<{ cancellation_state: string }>(
        'SELECT cancellation_state FROM execution_recovery_controls LIMIT 1',
      ),
    ).toEqual({ cancellation_state: 'cancelled' });
    expect(
      getExecutionJournalDb().getFirstSync<{ boundary: string }>(
        'SELECT boundary FROM execution_checkpoints ORDER BY sequence DESC LIMIT 1',
      ),
    ).toEqual({ boundary: 'terminal' });
  });

  it.each([0, 1, 2])(
    'fails a replay closed when checkpoint %i contract identity is altered',
    async (sequence) => {
      await dispatchAuthorizedToolEffect(writeInput(async () => verifiedWriteResult()), {
        now: () => 100,
      });
      getExecutionJournalDb().runSync(
        `UPDATE execution_checkpoints SET state_digest = ? WHERE sequence = ?`,
        'b'.repeat(64),
        sequence,
      );
      const replayExecutor = jest.fn(async () => verifiedWriteResult());

      const replay = await dispatchAuthorizedToolEffect(writeInput(replayExecutor), {
        now: () => 101,
      });

      expect(replay).toMatchObject({ kind: 'blocked' });
      expect(replayExecutor).not.toHaveBeenCalled();
    },
  );

  it('stores only bounded identities and digests, never raw arguments or results', async () => {
    await dispatchAuthorizedToolEffect(
      writeInput(async () =>
        JSON.stringify({
          status: 'written',
          path: 'private/plan.md',
          size: 4,
          sha256: 'a'.repeat(64),
          echoedSecret: 'must-never-be-journaled',
        }),
      ),
      { now: () => 100 },
    );

    const rows = JSON.stringify({
      runs: getExecutionJournalDb().getAllSync('SELECT * FROM execution_runs'),
      checkpoints: getExecutionJournalDb().getAllSync('SELECT * FROM execution_checkpoints'),
      effects: getExecutionJournalDb().getAllSync('SELECT * FROM execution_effects'),
    });
    expect(rows).not.toContain('must-never-be-journaled');
    expect(rows).not.toContain('private/plan.md');
    expect(rows).not.toContain('done');
  });
});
