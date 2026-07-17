jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

const mockInvalidateVerifiedProcedureObservationsForExecutionRun = jest.fn();
jest.mock('../../src/services/memory/verifiedProcedure/invalidation', () => ({
  invalidateVerifiedProcedureObservationsForExecutionRun: (...args: unknown[]) =>
    mockInvalidateVerifiedProcedureObservationsForExecutionRun(...args),
}));

import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import { dispatchAuthorizedToolEffect } from '../../src/services/executionJournal/toolEffectDispatchLifecycle';
import type { AuthorizedToolEffectDispatchInput } from '../../src/services/executionJournal/toolEffectDispatchLifecycle';
import { readToolEffectRestartDisposition } from '../../src/services/executionJournal/toolEffectRestartDisposition';
import type { RuntimeExternalToolEvidence } from '../../src/engine/toolExecution/toolContractIdentity';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../src/types/toolRuntimeOutcome';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';

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

function verifiedWriteResult(): ToolRuntimeOutcome {
  return completedToolOutcome(
    JSON.stringify({
      status: 'written',
      path: 'private/plan.md',
      size: 4,
      sha256: 'a'.repeat(64),
    }),
  );
}

function writeInput(
  execute: AuthorizedToolEffectDispatchInput['execute'],
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
      executionRunId: 'execution-run-1',
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
    modelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
    authority: authority(),
    execute,
    ...overrides,
  };
}

const MCP_EVIDENCE: RuntimeExternalToolEvidence = {
  declaration: {
    name: 'mcp__calendar__create_event',
    description: '[Calendar] Create event',
    input_schema: { type: 'object', properties: { title: { type: 'string' } } },
  },
  provenance: {
    source: 'mcp',
    namespace: 'calendar',
    connectionGeneration: 4,
    toolRegistryGeneration: 6,
    runtimeProcessEpoch: 'process-epoch-a',
    targetIdentity: 'https://calendar.example/mcp',
    transport: 'streamable-http',
  },
};

const SKILL_EVIDENCE: RuntimeExternalToolEvidence = {
  declaration: {
    name: 'skill__acme__deploy',
    description: '[Acme] Deploy',
    input_schema: { type: 'object', properties: { target: { type: 'string' } } },
  },
  provenance: {
    source: 'skill',
    namespace: 'acme',
    registrationGeneration: 9,
    runtimeProcessEpoch: 'process-epoch-a',
    name: 'Acme',
    version: '1.0.0',
  },
};

function dynamicInput(
  evidence: RuntimeExternalToolEvidence,
  execute: AuthorizedToolEffectDispatchInput['execute'],
  overrides: Partial<AuthorizedToolEffectDispatchInput> = {},
): AuthorizedToolEffectDispatchInput {
  const suffix = evidence.provenance.source;
  return {
    conversationId: `conversation-${suffix}`,
    toolCallId: `tool-call-${suffix}`,
    toolName: evidence.declaration.name,
    argumentsText: JSON.stringify({ target: 'private-target', title: 'Private event' }),
    context: {
      agentRunId: `agent-run-${suffix}`,
      executionRunId: `execution-run-${suffix}`,
    },
    approvalState: 'not_required',
    modelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
    authority: authority(),
    runtimeExternalEvidence: evidence,
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
  mockInvalidateVerifiedProcedureObservationsForExecutionRun.mockReturnValue({
    status: 'invalidated',
    deletedCount: 0,
  });
});

afterEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
});

describe('authorized durable tool effect dispatch', () => {
  it('settles from the executor status when opaque content sounds successful', async () => {
    const content = '完了しました — تم بنجاح — завершено';

    const result = await dispatchAuthorizedToolEffect(
      writeInput(async () => failedToolOutcome(content)),
      { now: () => 100 },
    );

    expect(result).toMatchObject({
      kind: 'executed',
      status: 'failed',
      result: content,
      requiresReconciliation: true,
      receipt: {
        transportState: 'returned',
        effectState: 'unknown',
        verificationState: 'unverified',
      },
    });
  });

  it('hands the executor only the exact persisted claim after authorization', async () => {
    const execute = jest.fn(async () => verifiedWriteResult());
    const input = writeInput(execute);

    await expect(dispatchAuthorizedToolEffect(input, { now: () => 100 })).resolves.toMatchObject({
      kind: 'executed',
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toEqual({
      executionRunId: 'execution-run-1',
      toolCallId: 'tool-call-write-1',
      claimedAt: 100,
    });
    expect(Object.isFrozen(execute.mock.calls[0]![0])).toBe(true);
  });

  it('keeps durable identities distinct across separate effect calls', async () => {
    const execute = jest.fn(async () => verifiedWriteResult());
    const secondInput = writeInput(execute);

    await expect(
      dispatchAuthorizedToolEffect(writeInput(execute), { now: () => 100 }),
    ).resolves.toMatchObject({ kind: 'executed' });
    await expect(
      dispatchAuthorizedToolEffect(
        {
          ...secondInput,
          toolCallId: 'tool-call-write-2',
          context: {
            ...secondInput.context,
            executionRunId: 'execution-run-2',
          },
        },
        { now: () => 101 },
      ),
    ).resolves.toMatchObject({ kind: 'executed' });

    const runIds = getExecutionJournalDb()
      .getAllSync<{ id: string }>('SELECT id FROM execution_runs ORDER BY id ASC')
      .map((row) => row.id);
    expect(runIds).toHaveLength(2);
    expect(new Set(runIds).size).toBe(2);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['MCP', MCP_EVIDENCE],
    ['skill', SKILL_EVIDENCE],
  ] as const)(
    'returns a successful %s result while durably preserving unknown external semantics',
    async (_label, evidence) => {
      const rawResult = JSON.stringify({
        status: 'completed',
        effectState: 'applied',
        verificationState: 'verified',
      });
      const execute = jest.fn(async () => completedToolOutcome(rawResult));
      const input = dynamicInput(evidence, execute);

      const first = await dispatchAuthorizedToolEffect(input, { now: () => 100 });

      expect(first).toMatchObject({
        kind: 'executed',
        result: rawResult,
        requiresReconciliation: true,
        executorThrew: false,
        receipt: {
          executionRunId: input.context.executionRunId,
          dispatchRunId: expect.stringMatching(/^effect-run-/u),
          effectKind: 'unknown',
          effectState: 'unknown',
          verificationState: 'unverified',
          contractIdentity: {
            kind: 'runtime_external',
            source: evidence.provenance.source,
          },
        },
      });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(
        getExecutionJournalDb().getFirstSync<{ run_status: string; effect_status: string }>(
          `SELECT r.status AS run_status, e.status AS effect_status
             FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
        ),
      ).toEqual({ run_status: 'ambiguous', effect_status: 'ambiguous' });

      await expect(
        readToolEffectRestartDisposition({
          conversationId: input.conversationId,
          executionRunId: input.context!.executionRunId!,
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          argumentsText: input.argumentsText,
        }),
      ).resolves.toEqual({
        kind: 'reconciliation_required',
        observedAt: 100,
        reason: 'ambiguous_effect',
      });

      const replayExecutor = jest.fn(async () => completedToolOutcome(rawResult));
      await expect(
        dispatchAuthorizedToolEffect(
          dynamicInput(evidence, replayExecutor, {
            conversationId: input.conversationId,
            toolCallId: input.toolCallId,
            argumentsText: input.argumentsText,
            context: input.context,
          }),
          { now: () => 101 },
        ),
      ).resolves.toMatchObject({ kind: 'reconciliation_required' });
      expect(replayExecutor).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['missing', undefined],
    [
      'mismatched',
      {
        ...MCP_EVIDENCE,
        declaration: { ...MCP_EVIDENCE.declaration, name: 'mcp__calendar__delete_event' },
      },
    ],
  ] as const)('blocks %s dynamic evidence before execution', async (_label, evidence) => {
    const execute = jest.fn(async () => completedToolOutcome('must not run'));
    const result = await dispatchAuthorizedToolEffect(
      dynamicInput(MCP_EVIDENCE, execute, { runtimeExternalEvidence: evidence }),
      { now: () => 100 },
    );

    expect(result).toMatchObject({ kind: 'blocked' });
    expect(execute).not.toHaveBeenCalled();
    expect(count('execution_runs')).toBe(0);
  });

  it('blocks a changed runtime generation from borrowing an existing durable claim', async () => {
    const firstExecutor = jest.fn(async () => completedToolOutcome('{"status":"completed"}'));
    const firstInput = dynamicInput(MCP_EVIDENCE, firstExecutor);
    await expect(
      dispatchAuthorizedToolEffect(firstInput, { now: () => 100 }),
    ).resolves.toMatchObject({ kind: 'executed' });
    const changedEvidence: RuntimeExternalToolEvidence = {
      ...MCP_EVIDENCE,
      provenance: { ...MCP_EVIDENCE.provenance, connectionGeneration: 5 },
    };
    const changedExecutor = jest.fn(async () => completedToolOutcome('{"status":"completed"}'));

    await expect(
      dispatchAuthorizedToolEffect(
        dynamicInput(changedEvidence, changedExecutor, {
          conversationId: firstInput.conversationId,
          toolCallId: firstInput.toolCallId,
          argumentsText: firstInput.argumentsText,
          context: firstInput.context,
        }),
        { now: () => 101 },
      ),
    ).resolves.toMatchObject({ kind: 'reconciliation_required' });
    expect(firstExecutor).toHaveBeenCalledTimes(1);
    expect(changedExecutor).not.toHaveBeenCalled();
  });

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
        executionRunId: 'execution-run-1',
        dispatchRunId: expect.stringMatching(/^effect-run-/u),
        effectKind: 'artifact.write',
        effectState: 'applied',
        verificationState: 'verified',
      },
    });
    if (result.kind !== 'executed') throw new Error('expected_executed_effect');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT r.status AS run_status, r.durability_class, r.task_id,
                e.status AS effect_status, e.outcome_digest
         FROM execution_runs r
         JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({
      run_status: 'succeeded',
      durability_class: 'external_durable_operation',
      task_id: 'execution-run-1',
      effect_status: 'verified',
      outcome_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(count('execution_checkpoints')).toBe(4);
    expect(
      getExecutionJournalDb().getFirstSync<{ boundary: string; phase: string }>(
        'SELECT boundary, phase FROM execution_checkpoints ORDER BY sequence DESC LIMIT 1',
      ),
    ).toEqual({ boundary: 'terminal', phase: 'deliver' });
    const persistedReceipt = getExecutionJournalDb().getFirstSync<{
      receipt_digest: string;
      receipt_json: string;
      recorded_at: number;
    }>('SELECT receipt_digest, receipt_json, recorded_at FROM execution_effect_receipts');
    expect(persistedReceipt).toEqual({
      receipt_digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      receipt_json: JSON.stringify(result.receipt),
      recorded_at: result.receipt.recordedAt,
    });
    expect(() =>
      getExecutionJournalDb().runSync(
        'UPDATE execution_effect_receipts SET persisted_at = persisted_at + 1',
      ),
    ).toThrow('execution_effect_receipt_immutable');
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
    const replay = dispatchAuthorizedToolEffect(writeInput(replayExecutor), {
      now: () => 101,
    });
    releaseFirst();

    await expect(first).resolves.toMatchObject({ kind: 'executed' });
    await expect(replay).resolves.toMatchObject({ kind: 'reconciliation_required' });
    expect(firstExecutor).toHaveBeenCalledTimes(1);
    expect(replayExecutor).not.toHaveBeenCalled();
    expect(mockInvalidateVerifiedProcedureObservationsForExecutionRun).toHaveBeenCalledWith(
      'execution-run-1',
    );
  });

  it('suppresses an exact replay after verified settlement', async () => {
    const firstExecutor = jest.fn(async () => verifiedWriteResult());
    const replayExecutor = jest.fn(async () => verifiedWriteResult());

    const first = await dispatchAuthorizedToolEffect(writeInput(firstExecutor), {
      now: () => 100,
    });
    expect(first).toMatchObject({ kind: 'executed' });
    expect(count('execution_effect_receipts')).toBe(1);
    closeExecutionJournalDb();

    const replay = await dispatchAuthorizedToolEffect(writeInput(replayExecutor), {
      now: () => 101,
    });

    expect(replay).toMatchObject({
      kind: 'reconciliation_required',
      reason: 'duplicate_suppressed',
    });
    expect(replay.result).toContain('do not retry automatically');
    expect(firstExecutor).toHaveBeenCalledTimes(1);
    expect(replayExecutor).not.toHaveBeenCalled();
    expect(count('execution_effect_receipts')).toBe(1);
  });

  it('rejects a persisted receipt digest conflict without executing again', async () => {
    const firstExecutor = jest.fn(async () => verifiedWriteResult());
    const replayExecutor = jest.fn(async () => verifiedWriteResult());

    await expect(
      dispatchAuthorizedToolEffect(writeInput(firstExecutor), { now: () => 100 }),
    ).resolves.toMatchObject({ kind: 'executed' });
    getExecutionJournalDb().execSync('DROP TRIGGER trg_execution_effect_receipts_immutable');
    getExecutionJournalDb().runSync(
      `UPDATE execution_effect_receipts SET receipt_digest = ?`,
      'f'.repeat(64),
    );

    await expect(
      dispatchAuthorizedToolEffect(writeInput(replayExecutor), { now: () => 101 }),
    ).resolves.toMatchObject({ kind: 'blocked', reason: 'state_unavailable' });
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

  it('surfaces settlement loss after dispatch and durably marks reconciliation', async () => {
    const database = getExecutionJournalDb();
    let databaseRequest = 0;
    const execute = jest.fn(async () => verifiedWriteResult());

    const result = await dispatchAuthorizedToolEffect(writeInput(execute), {
      now: () => 100,
      getDatabase: () => {
        databaseRequest += 1;
        if (databaseRequest === 5) {
          throw new Error('settlement connection lost');
        }
        return database;
      },
    });

    expect(result).toMatchObject({ kind: 'reconciliation_required' });
    expect(result.result).toContain('settlement_unavailable');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      database.getFirstSync<{ run_status: string; effect_status: string }>(
        `SELECT r.status AS run_status, e.status AS effect_status
         FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'ambiguous', effect_status: 'ambiguous' });
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
      await dispatchAuthorizedToolEffect(
        writeInput(async () => verifiedWriteResult()),
        {
          now: () => 100,
        },
      );
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
        completedToolOutcome(
          JSON.stringify({
            status: 'written',
            path: 'private/plan.md',
            size: 4,
            sha256: 'a'.repeat(64),
            echoedSecret: 'must-never-be-journaled',
          }),
        ),
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
