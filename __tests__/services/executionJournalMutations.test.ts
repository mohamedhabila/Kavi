jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import {
  appendExecutionCheckpoint,
  createExecutionRun,
  registerExecutionExternalHandle,
  transitionExecutionEffect,
  transitionExecutionExternalHandle,
  transitionExecutionRun,
} from '../../src/services/executionJournal/mutations';
import {
  appendBeforeEffectCheckpoint as appendBeforeEffect,
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  DIGEST_D,
  executionCheckpointRecord as checkpointRecord,
  executionRunRecord as runRecord,
  planFixtureEffect as planEffect,
  seedExecutionRun as seedRun,
  seedPlannedFixtureEffect as seedPlannedEffect,
  startExecutionRun as startRun,
  startFixtureEffect as startEffect,
} from '../helpers/executionJournalMutationFixtures';

const sqliteMock = jest.requireMock('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
  sqliteMock.__resetExpoSqliteForTests();
});

afterEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {
    // Ignore teardown of an intentionally rejected handle.
  }
});

describe('execution journal run creation and checkpoints', () => {
  it('atomically creates a queued run with its canonical initial checkpoint', () => {
    const run = seedRun();
    const db = getExecutionJournalDb();
    expect(
      db.getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM execution_runs')?.count,
    ).toBe(1);
    expect(
      db.getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM execution_checkpoints')
        ?.count,
    ).toBe(1);
    expect(
      db.getFirstSync<{ cancellation_state: string }>(
        'SELECT cancellation_state FROM execution_recovery_controls WHERE run_id = ?',
        run.id,
      ),
    ).toEqual({ cancellation_state: 'active' });
    expect(run.status).toBe('queued');
  });

  it('rolls back the run when its initial checkpoint cannot be inserted', () => {
    seedRun();
    const second = runRecord({
      id: 'run-2',
      conversationId: 'conversation-2',
      threadId: 'thread-2',
      taskId: 'task-2',
      goalId: 'goal-2',
      requestMessageId: 'message-2',
    });
    expect(() =>
      createExecutionRun({
        run: second,
        initialCheckpoint: checkpointRecord(second, { id: 'checkpoint-0' }),
      }),
    ).toThrow();
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM execution_runs WHERE id = 'run-2'`,
      )?.count,
    ).toBe(0);
  });

  it('rejects noncanonical initial state before opening a partial transaction', () => {
    const run = runRecord();
    expect(() =>
      createExecutionRun({
        run,
        initialCheckpoint: checkpointRecord(run, { boundary: 'before_model' }),
      }),
    ).toThrow('execution_journal_invalid_initial_state');
  });

  it('allocates monotonic checkpoint sequences and updates the run summary', () => {
    seedRun();
    startRun();
    const first = appendExecutionCheckpoint({
      id: 'checkpoint-1',
      runId: 'run-1',
      expectedControlEpoch: 0,
      taskId: 'task-1',
      goalId: 'goal-1',
      phase: 'work',
      boundary: 'before_model',
      stateRefId: 'state-1',
      stateDigest: DIGEST_C,
      resumeStrategy: 'reconcile_first',
      approvalState: 'pending',
      permissionState: 'pending',
      createdAt: 12,
    });
    const second = appendBeforeEffect({ createdAt: 13 });
    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    expect(
      getExecutionJournalDb().getFirstSync<{
        updated_at: number;
        resume_strategy: string;
      }>('SELECT updated_at, resume_strategy FROM execution_runs WHERE id = ?', 'run-1'),
    ).toEqual({ updated_at: 13, resume_strategy: 'replay_safe' });
  });

  it('rejects stale epochs and nonmonotonic checkpoint times without inserting', () => {
    seedRun();
    startRun();
    transitionExecutionRun({
      runId: 'run-1',
      expectedStatus: 'running',
      nextStatus: 'interrupted',
      expectedControlEpoch: 0,
      nextControlEpoch: 1,
      occurredAt: 12,
    });
    expect(() => appendBeforeEffect({ expectedControlEpoch: 0, createdAt: 13 })).toThrow(
      'execution_journal_stale_control_epoch',
    );
    expect(() => appendBeforeEffect({ expectedControlEpoch: 1, createdAt: 11 })).toThrow(
      'execution_journal_non_monotonic_time',
    );
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM execution_checkpoints',
      )?.count,
    ).toBe(1);
  });
});

describe('closed run transitions', () => {
  it('atomically transitions status, terminal time, and an optional epoch increment', () => {
    seedRun();
    startRun();
    const terminal = transitionExecutionRun({
      runId: 'run-1',
      expectedStatus: 'running',
      nextStatus: 'succeeded',
      expectedControlEpoch: 0,
      nextControlEpoch: 1,
      occurredAt: 12,
    });
    expect(terminal).toEqual(
      expect.objectContaining({ status: 'succeeded', controlEpoch: 1, terminalAt: 12 }),
    );
    expect(() =>
      transitionExecutionRun({
        runId: 'run-1',
        expectedStatus: 'succeeded',
        nextStatus: 'running',
        expectedControlEpoch: 1,
        nextControlEpoch: 1,
        occurredAt: 13,
      }),
    ).toThrow('execution_journal_terminal_run');
  });

  it('rejects illegal, conflicting, skipped-epoch, and backward-time transitions', () => {
    seedRun();
    expect(() =>
      transitionExecutionRun({
        runId: 'run-1',
        expectedStatus: 'queued',
        nextStatus: 'succeeded',
        expectedControlEpoch: 0,
        nextControlEpoch: 0,
        occurredAt: 11,
      }),
    ).toThrow('execution_journal_illegal_run_transition:queued:succeeded');
    expect(() =>
      transitionExecutionRun({
        runId: 'run-1',
        expectedStatus: 'running',
        nextStatus: 'blocked',
        expectedControlEpoch: 0,
        nextControlEpoch: 0,
        occurredAt: 11,
      }),
    ).toThrow('execution_journal_run_status_conflict');
    expect(() =>
      transitionExecutionRun({
        runId: 'run-1',
        expectedStatus: 'queued',
        nextStatus: 'running',
        expectedControlEpoch: 0,
        nextControlEpoch: 2,
        occurredAt: 11,
      }),
    ).toThrow('execution_journal_invalid_next_control_epoch');
    expect(() =>
      transitionExecutionRun({
        runId: 'run-1',
        expectedStatus: 'queued',
        nextStatus: 'running',
        expectedControlEpoch: 0,
        nextControlEpoch: 0,
        occurredAt: 9,
      }),
    ).toThrow('execution_journal_non_monotonic_time');
  });
});

describe('effect planning and transitions', () => {
  it('plans an effect only from the latest fresh before-effect checkpoint', () => {
    seedPlannedEffect();
    expect(
      getExecutionJournalDb().getFirstSync<Record<string, unknown>>(
        'SELECT status, checkpoint_id, started_at FROM execution_effects WHERE id = ?',
        'effect-1',
      ),
    ).toEqual({ status: 'planned', checkpoint_id: 'checkpoint-effect', started_at: null });
  });

  it('rejects initial, stale, and superseded checkpoints as effect boundaries', () => {
    seedRun();
    startRun();
    expect(() => planEffect({ checkpointId: 'checkpoint-0', createdAt: 12 })).toThrow(
      'execution_journal_unsafe_effect_checkpoint',
    );
    appendBeforeEffect();
    appendExecutionCheckpoint({
      id: 'checkpoint-after',
      runId: 'run-1',
      expectedControlEpoch: 0,
      taskId: 'task-1',
      goalId: 'goal-1',
      phase: 'work',
      boundary: 'after_model',
      stateRefId: 'state-after',
      stateDigest: DIGEST_C,
      resumeStrategy: 'replay_safe',
      approvalState: 'not_required',
      permissionState: 'granted',
      createdAt: 13,
    });
    expect(() => planEffect({ createdAt: 14 })).toThrow(
      'execution_journal_unsafe_effect_checkpoint',
    );
    transitionExecutionRun({
      runId: 'run-1',
      expectedStatus: 'running',
      nextStatus: 'interrupted',
      expectedControlEpoch: 0,
      nextControlEpoch: 1,
      occurredAt: 14,
    });
    expect(() => planEffect({ expectedControlEpoch: 0, createdAt: 15 })).toThrow(
      'execution_journal_stale_control_epoch',
    );
  });

  it('requires planning authority and policy-consistent retry metadata', () => {
    seedRun();
    startRun();
    appendExecutionCheckpoint({
      id: 'checkpoint-pending',
      runId: 'run-1',
      expectedControlEpoch: 0,
      taskId: 'task-1',
      goalId: 'goal-1',
      phase: 'work',
      boundary: 'before_effect',
      stateRefId: 'state-pending',
      stateDigest: DIGEST_C,
      resumeStrategy: 'reconcile_first',
      approvalState: 'pending',
      permissionState: 'granted',
      createdAt: 12,
    });
    expect(() => planEffect({ checkpointId: 'checkpoint-pending', createdAt: 13 })).toThrow(
      'execution_journal_effect_planning_authority_not_granted',
    );
    appendBeforeEffect({ id: 'checkpoint-safe', createdAt: 14 });
    expect(() =>
      planEffect({
        checkpointId: 'checkpoint-safe',
        createdAt: 15,
        effectClass: 'none',
        idempotencyClass: 'not_declared',
      }),
    ).toThrow('execution_journal_inconsistent_effect_policy');
    expect(() =>
      planEffect({
        checkpointId: 'checkpoint-safe',
        createdAt: 15,
        retryPolicy: 'replay_safe',
      }),
    ).toThrow('execution_journal_unsafe_replay_policy');
    expect(() =>
      planEffect({
        checkpointId: 'checkpoint-safe',
        createdAt: 15,
        effectClass: 'destructive',
        idempotencyClass: 'not_declared',
      }),
    ).toThrow('execution_journal_unsafe_effect_retry_policy');
  });

  it('records start, application, and verification without rewriting prior timestamps', () => {
    seedPlannedEffect();
    startEffect();
    const applied = transitionExecutionEffect({
      runId: 'run-1',
      effectId: 'effect-1',
      expectedStatus: 'started',
      nextStatus: 'applied',
      expectedControlEpoch: 0,
      occurredAt: 15,
      outcomeDigest: DIGEST_C,
    });
    const verified = transitionExecutionEffect({
      runId: 'run-1',
      effectId: 'effect-1',
      expectedStatus: 'applied',
      nextStatus: 'verified',
      expectedControlEpoch: 0,
      occurredAt: 16,
    });
    expect(applied).toEqual(
      expect.objectContaining({ startedAt: 14, completedAt: 15, outcomeDigest: DIGEST_C }),
    );
    expect(verified).toEqual(
      expect.objectContaining({ status: 'verified', startedAt: 14, completedAt: 15 }),
    );
  });

  it('requires fresh granted authority evidence when an effect actually starts', () => {
    seedPlannedEffect();
    expect(() =>
      transitionExecutionEffect({
        runId: 'run-1',
        effectId: 'effect-1',
        expectedStatus: 'planned',
        nextStatus: 'started',
        expectedControlEpoch: 0,
        occurredAt: 14,
      }),
    ).toThrow('execution_journal_execution_authority_revalidation_required');
    appendBeforeEffect({ id: 'checkpoint-revoked', createdAt: 14, approvalState: 'expired' });
    expect(() =>
      transitionExecutionEffect({
        runId: 'run-1',
        effectId: 'effect-1',
        expectedStatus: 'planned',
        nextStatus: 'started',
        expectedControlEpoch: 0,
        occurredAt: 14,
        executionAuthorityCheckpointId: 'checkpoint-revoked',
      }),
    ).toThrow('execution_journal_execution_authority_not_granted');
  });

  it('resolves an ambiguous in-flight effect through a digested terminal outcome', () => {
    seedPlannedEffect();
    startEffect();
    const ambiguous = transitionExecutionEffect({
      runId: 'run-1',
      effectId: 'effect-1',
      expectedStatus: 'started',
      nextStatus: 'ambiguous',
      expectedControlEpoch: 0,
      occurredAt: 15,
    });
    const failed = transitionExecutionEffect({
      runId: 'run-1',
      effectId: 'effect-1',
      expectedStatus: 'ambiguous',
      nextStatus: 'failed',
      expectedControlEpoch: 0,
      occurredAt: 16,
      outcomeDigest: DIGEST_D,
    });
    expect(ambiguous.completedAt).toBeNull();
    expect(
      getExecutionJournalDb().getFirstSync<{ status: string }>(
        'SELECT status FROM execution_runs WHERE id = ?',
        'run-1',
      )?.status,
    ).toBe('ambiguous');
    expect(failed).toEqual(
      expect.objectContaining({ status: 'failed', completedAt: 16, outcomeDigest: DIGEST_D }),
    );
  });

  it('does not plan new effects while a run is unresolved', () => {
    seedPlannedEffect();
    startEffect();
    transitionExecutionEffect({
      runId: 'run-1',
      effectId: 'effect-1',
      expectedStatus: 'started',
      nextStatus: 'ambiguous',
      expectedControlEpoch: 0,
      occurredAt: 15,
    });
    appendBeforeEffect({ id: 'checkpoint-second', createdAt: 16 });
    expect(() =>
      planEffect({ id: 'effect-2', checkpointId: 'checkpoint-second', createdAt: 17 }),
    ).toThrow('execution_journal_run_not_executing');
  });

  it('rolls back illegal or incomplete effect transitions', () => {
    seedPlannedEffect();
    expect(() =>
      transitionExecutionEffect({
        runId: 'run-1',
        effectId: 'effect-1',
        expectedStatus: 'planned',
        nextStatus: 'applied',
        expectedControlEpoch: 0,
        occurredAt: 14,
        outcomeDigest: DIGEST_C,
      }),
    ).toThrow('execution_journal_illegal_effect_transition:planned:applied');
    startEffect();
    expect(() =>
      transitionExecutionEffect({
        runId: 'run-1',
        effectId: 'effect-1',
        expectedStatus: 'started',
        nextStatus: 'applied',
        expectedControlEpoch: 0,
        occurredAt: 15,
      }),
    ).toThrow('execution_journal_effect_outcome_digest_required');
    expect(
      getExecutionJournalDb().getFirstSync<{ status: string }>(
        'SELECT status FROM execution_effects WHERE id = ?',
        'effect-1',
      )?.status,
    ).toBe('started');
  });

  it('prevents terminal run labels while an effect remains unresolved', () => {
    seedPlannedEffect();
    expect(() =>
      transitionExecutionRun({
        runId: 'run-1',
        expectedStatus: 'running',
        nextStatus: 'failed',
        expectedControlEpoch: 0,
        nextControlEpoch: 0,
        occurredAt: 14,
      }),
    ).toThrow('execution_journal_unresolved_work_prevents_terminal');
    expect(
      getExecutionJournalDb().getFirstSync<{ status: string }>(
        'SELECT status FROM execution_runs WHERE id = ?',
        'run-1',
      )?.status,
    ).toBe('running');
  });
});

describe('external handle registration and transitions', () => {
  function registerPendingHandle() {
    return registerExecutionExternalHandle({
      id: 'handle-1',
      runId: 'run-1',
      effectId: 'effect-1',
      expectedControlEpoch: 0,
      locator: {
        version: 1,
        kind: 'expo_workflow_run',
        projectId: 'project-1',
        workflowRunId: 'workflow-run-1',
        credentialRef: 'EXPO_TOKEN',
      },
      sourceToolNameDigest: DIGEST_A,
      status: 'pending',
      createdAt: 15,
    });
  }

  it('registers only a started effect handle from the same tool contract', () => {
    seedPlannedEffect();
    expect(() => registerPendingHandle()).toThrow(
      'execution_journal_external_handle_before_effect_start',
    );
    startEffect();
    expect(() =>
      registerExecutionExternalHandle({
        id: 'bad-handle',
        runId: 'run-1',
        effectId: 'effect-1',
        expectedControlEpoch: 0,
        locator: {
          version: 1,
          kind: 'expo_workflow_run',
          projectId: 'project-1',
          workflowRunId: 'workflow-run-bad',
          credentialRef: 'EXPO_TOKEN',
        },
        sourceToolNameDigest: DIGEST_D,
        status: 'pending',
        createdAt: 15,
      }),
    ).toThrow('execution_journal_external_handle_tool_mismatch');
    expect(registerPendingHandle()).toEqual(
      expect.objectContaining({ status: 'pending', lastVerifiedAt: 15 }),
    );
  });

  it('records each verified handle observation and makes terminal states immutable', () => {
    seedPlannedEffect();
    startEffect();
    registerPendingHandle();
    const running = transitionExecutionExternalHandle({
      runId: 'run-1',
      handleId: 'handle-1',
      expectedStatus: 'pending',
      nextStatus: 'running',
      expectedControlEpoch: 0,
      occurredAt: 16,
    });
    const succeeded = transitionExecutionExternalHandle({
      runId: 'run-1',
      handleId: 'handle-1',
      expectedStatus: 'running',
      nextStatus: 'succeeded',
      expectedControlEpoch: 0,
      occurredAt: 17,
    });
    expect(running.lastVerifiedAt).toBe(16);
    expect(succeeded.lastVerifiedAt).toBe(17);
    expect(() =>
      transitionExecutionExternalHandle({
        runId: 'run-1',
        handleId: 'handle-1',
        expectedStatus: 'succeeded',
        nextStatus: 'running',
        expectedControlEpoch: 0,
        occurredAt: 18,
      }),
    ).toThrow('execution_journal_illegal_external_handle_transition:succeeded:running');
  });

  it('rejects stale handle observations without changing the persisted status', () => {
    seedPlannedEffect();
    startEffect();
    registerPendingHandle();
    transitionExecutionRun({
      runId: 'run-1',
      expectedStatus: 'running',
      nextStatus: 'interrupted',
      expectedControlEpoch: 0,
      nextControlEpoch: 1,
      occurredAt: 16,
    });
    expect(() =>
      transitionExecutionExternalHandle({
        runId: 'run-1',
        handleId: 'handle-1',
        expectedStatus: 'pending',
        nextStatus: 'running',
        expectedControlEpoch: 0,
        occurredAt: 17,
      }),
    ).toThrow('execution_journal_stale_control_epoch');
    expect(
      getExecutionJournalDb().getFirstSync<{ status: string }>(
        'SELECT status FROM execution_external_handles WHERE id = ?',
        'handle-1',
      )?.status,
    ).toBe('pending');
  });

  it('prevents terminal run labels until a durable external handle is resolved', () => {
    seedPlannedEffect();
    startEffect();
    registerPendingHandle();
    transitionExecutionEffect({
      runId: 'run-1',
      effectId: 'effect-1',
      expectedStatus: 'started',
      nextStatus: 'applied',
      expectedControlEpoch: 0,
      occurredAt: 16,
      outcomeDigest: DIGEST_C,
    });
    transitionExecutionEffect({
      runId: 'run-1',
      effectId: 'effect-1',
      expectedStatus: 'applied',
      nextStatus: 'verified',
      expectedControlEpoch: 0,
      occurredAt: 17,
    });
    expect(() =>
      transitionExecutionRun({
        runId: 'run-1',
        expectedStatus: 'running',
        nextStatus: 'succeeded',
        expectedControlEpoch: 0,
        nextControlEpoch: 0,
        occurredAt: 18,
      }),
    ).toThrow('execution_journal_unresolved_work_prevents_terminal');
    transitionExecutionExternalHandle({
      runId: 'run-1',
      handleId: 'handle-1',
      expectedStatus: 'pending',
      nextStatus: 'succeeded',
      expectedControlEpoch: 0,
      occurredAt: 18,
    });
    expect(
      transitionExecutionRun({
        runId: 'run-1',
        expectedStatus: 'running',
        nextStatus: 'succeeded',
        expectedControlEpoch: 0,
        nextControlEpoch: 0,
        occurredAt: 19,
      }).status,
    ).toBe('succeeded');
  });
});
