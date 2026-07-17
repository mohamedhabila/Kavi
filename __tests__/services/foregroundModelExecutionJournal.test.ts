jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  activateForegroundModelExecution,
  completeForegroundModelExecution,
  createForegroundModelExecution,
} from '../../src/services/executionJournal/foregroundModelExecutionJournal';
import { listPendingForegroundModelExecutions } from '../../src/services/executionJournal/foregroundModelExecutionQueries';
import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import { appendExecutionCheckpoint } from '../../src/services/executionJournal/mutations';
import { insertRun } from '../../src/services/executionJournal/mutationStore';
import { AGENT_RUNTIME_ERROR_CODES } from '../../src/services/runtimeError';

const DIGEST = 'a'.repeat(64);
const sqliteMock = jest.requireMock('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function idFactory() {
  let sequence = 0;
  return () => `id-${++sequence}`;
}

function options(clock = 10) {
  return {
    clock: () => clock,
    digest: async () => DIGEST,
    generateId: idFactory(),
  };
}

async function begin() {
  const journalOptions = options();
  const created = await createForegroundModelExecution(
    {
      runId: 'run-1',
      conversationId: 'conversation-1',
      requestMessageId: 'request-1',
      assistantMessageId: 'assistant-1',
      taskId: 'task-1',
      requestState: { messages: ['private request text'] },
      modelState: { providerId: 'provider-1', model: 'model-1' },
    },
    journalOptions,
  );
  return activateForegroundModelExecution({ lease: created }, journalOptions);
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

describe('foreground model execution journal', () => {
  it('creates a queued generation before atomically arming model execution', async () => {
    const journalOptions = options();
    const created = await createForegroundModelExecution(
      {
        runId: 'run-1',
        conversationId: 'conversation-1',
        requestMessageId: 'request-1',
        assistantMessageId: 'assistant-1',
        taskId: 'task-1',
        requestState: { messages: ['private request text'] },
        modelState: { providerId: 'provider-1', model: 'model-1' },
      },
      journalOptions,
    );
    const database = getExecutionJournalDb();

    expect(created).toEqual(
      expect.objectContaining({
        expectedStatus: 'queued',
        checkpointId: 'foreground-created-id-1',
        createdAt: 10,
      }),
    );
    expect(
      database.getAllSync<Record<string, unknown>>(
        `SELECT sequence, boundary FROM execution_checkpoints
         WHERE run_id = ? ORDER BY sequence ASC`,
        created.runId,
      ),
    ).toEqual([{ sequence: 0, boundary: 'run_created' }]);

    const lease = await activateForegroundModelExecution({ lease: created }, journalOptions);

    expect(lease).toEqual({
      runId: 'run-1',
      conversationId: 'conversation-1',
      requestMessageId: 'request-1',
      assistantMessageId: 'assistant-1',
      taskId: 'task-1',
      createdAt: 10,
      expectedStatus: 'running',
      controlEpoch: 0,
      updatedAt: 10,
      checkpointId: 'foreground-before-model-id-2',
      checkpointStateDigest: DIGEST,
    });
    expect(
      database.getFirstSync<Record<string, unknown>>(
        `SELECT conversation_id, thread_id, request_message_id, durability_class,
                execution_surface, status, resume_strategy, next_retry_policy
         FROM execution_runs WHERE id = ?`,
        lease.runId,
      ),
    ).toEqual({
      conversation_id: 'conversation-1',
      thread_id: 'conversation-1',
      request_message_id: 'request-1',
      durability_class: 'foreground_interactive',
      execution_surface: 'model',
      status: 'running',
      resume_strategy: 'not_resumable',
      next_retry_policy: 'none',
    });
    expect(
      database.getAllSync<Record<string, unknown>>(
        `SELECT sequence, boundary, state_ref_id FROM execution_checkpoints
         WHERE run_id = ? ORDER BY sequence ASC`,
        lease.runId,
      ),
    ).toEqual([
      { sequence: 0, boundary: 'run_created', state_ref_id: 'assistant-1' },
      { sequence: 1, boundary: 'before_model', state_ref_id: 'assistant-1' },
    ]);
    expect(JSON.stringify(database.getFirstSync('SELECT * FROM execution_runs'))).not.toContain(
      'private request text',
    );
  });

  it('atomically closes the exact generation after the durable projection exists', async () => {
    const lease = await begin();
    const completed = await completeForegroundModelExecution(
      {
        lease,
        status: 'succeeded',
        projectionMessageId: 'assistant-final',
        projectionState: { completionStatus: 'complete' },
      },
      options(20),
    );

    expect(completed).toEqual(
      expect.objectContaining({
        status: 'succeeded',
        controlEpoch: 1,
        updatedAt: 20,
        terminalAt: 20,
      }),
    );
    expect(
      getExecutionJournalDb().getAllSync<Record<string, unknown>>(
        `SELECT sequence, boundary, state_ref_id, control_epoch
         FROM execution_checkpoints WHERE run_id = ? ORDER BY sequence ASC`,
        lease.runId,
      ),
    ).toEqual([
      {
        sequence: 0,
        boundary: 'run_created',
        state_ref_id: 'assistant-1',
        control_epoch: 0,
      },
      {
        sequence: 1,
        boundary: 'before_model',
        state_ref_id: 'assistant-1',
        control_epoch: 0,
      },
      {
        sequence: 2,
        boundary: 'terminal',
        state_ref_id: 'assistant-final',
        control_epoch: 1,
      },
    ]);
    expect(listPendingForegroundModelExecutions()).toEqual([]);
  });

  it('rejects a stale checkpoint generation without writing a terminal projection', async () => {
    const lease = await begin();
    appendExecutionCheckpoint({
      id: 'unexpected-checkpoint',
      runId: lease.runId,
      expectedControlEpoch: 0,
      taskId: lease.taskId,
      goalId: null,
      phase: 'work',
      boundary: 'safe_yield',
      stateRefId: lease.assistantMessageId,
      stateDigest: DIGEST,
      resumeStrategy: 'not_resumable',
      approvalState: 'not_required',
      permissionState: 'granted',
      createdAt: 11,
    });

    await expect(
      completeForegroundModelExecution(
        {
          lease,
          status: 'failed',
          projectionMessageId: 'assistant-1',
          projectionState: { completionStatus: 'incomplete' },
        },
        options(20),
      ),
    ).rejects.toMatchObject({
      code: AGENT_RUNTIME_ERROR_CODES.FOREGROUND_MODEL_GENERATION_CHANGED,
      message: 'foreground_model_journal_generation_changed',
    });
    expect(
      getExecutionJournalDb().getFirstSync<{ status: string }>(
        'SELECT status FROM execution_runs WHERE id = ?',
        lease.runId,
      ),
    ).toEqual({ status: 'running' });
  });

  it('refuses to close a forged owner or a generation containing unjournaled effect state', async () => {
    const lease = await begin();
    await expect(
      completeForegroundModelExecution(
        {
          lease: { ...lease, conversationId: 'conversation-2' },
          status: 'failed',
          projectionMessageId: 'assistant-1',
          projectionState: {},
        },
        options(20),
      ),
    ).rejects.toThrow('foreground_model_journal_ownership_changed');

    const database = getExecutionJournalDb();
    database.runSync(
      `INSERT INTO execution_effects (
         id, run_id, checkpoint_id, tool_call_id, tool_name_digest, effect_class,
         idempotency_class, idempotency_key_digest, request_digest, outcome_digest,
         status, retry_policy, attempt, created_at, started_at, completed_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'effect-1',
      lease.runId,
      lease.checkpointId,
      'tool-call-1',
      DIGEST,
      'none',
      'effect_free',
      null,
      DIGEST,
      null,
      'planned',
      'replay_safe',
      1,
      10,
      null,
      null,
      10,
    );
    await expect(
      completeForegroundModelExecution(
        {
          lease,
          status: 'failed',
          projectionMessageId: 'assistant-1',
          projectionState: {},
        },
        options(20),
      ),
    ).rejects.toThrow('foreground_model_journal_effect_state_present');
  });

  it('allows only one terminal consumer of a lease and persists cancellation control', async () => {
    const lease = await begin();
    await completeForegroundModelExecution(
      {
        lease,
        status: 'cancelled',
        projectionMessageId: 'assistant-1',
        projectionState: { cancelled: true },
      },
      options(20),
    );
    await expect(
      completeForegroundModelExecution(
        {
          lease,
          status: 'cancelled',
          projectionMessageId: 'assistant-1',
          projectionState: { cancelled: true },
        },
        options(21),
      ),
    ).rejects.toMatchObject({
      code: AGENT_RUNTIME_ERROR_CODES.FOREGROUND_MODEL_GENERATION_CHANGED,
      message: 'foreground_model_journal_generation_changed',
    });
    expect(
      getExecutionJournalDb().getFirstSync<{ cancellation_state: string }>(
        'SELECT cancellation_state FROM execution_recovery_controls WHERE run_id = ?',
        lease.runId,
      ),
    ).toEqual({ cancellation_state: 'cancelled' });
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM execution_checkpoints
         WHERE run_id = ? AND boundary = 'terminal'`,
        lease.runId,
      )?.count,
    ).toBe(1);
  });

  it('keeps a committed terminal result when bounded retention maintenance fails', async () => {
    const lease = await begin();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const maintainRetention = jest.fn(() => {
      throw new Error('retention unavailable');
    });

    await expect(
      completeForegroundModelExecution(
        {
          lease,
          status: 'succeeded',
          projectionMessageId: 'assistant-1',
          projectionState: { complete: true },
        },
        { ...options(20), maintainRetention },
      ),
    ).resolves.toEqual(expect.objectContaining({ status: 'succeeded' }));
    expect(maintainRetention).toHaveBeenCalledWith({ now: 20 });
    expect(warn).toHaveBeenCalledWith(
      '[execution-journal] foreground model retention failed:',
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it('enforces the retained-row cap from the normal terminal completion path', async () => {
    const database = getExecutionJournalDb();
    for (let index = 0; index < 2_000; index += 1) {
      insertRun(database, {
        id: `old-${String(index).padStart(4, '0')}`,
        conversationId: 'old-conversation',
        threadId: 'old-conversation',
        taskId: null,
        goalId: null,
        requestMessageId: 'old-request',
        durabilityClass: 'foreground_interactive',
        requestedCapability: 'compute',
        executionSurface: 'model',
        status: 'succeeded',
        resumeStrategy: 'not_resumable',
        approvalState: 'not_required',
        permissionState: 'granted',
        inputDigest: DIGEST,
        modelConfigDigest: DIGEST,
        retryCount: 0,
        nextRetryPolicy: 'none',
        controlEpoch: 1,
        createdAt: 0,
        updatedAt: 1,
        terminalAt: 1,
      });
    }
    const lease = await begin();

    await completeForegroundModelExecution(
      {
        lease,
        status: 'succeeded',
        projectionMessageId: 'assistant-1',
        projectionState: { complete: true },
      },
      options(20),
    );

    expect(
      database.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM execution_runs
         WHERE durability_class = 'foreground_interactive'
           AND execution_surface = 'model'
           AND status IN ('succeeded', 'failed', 'cancelled')`,
      )?.count,
    ).toBe(2_000);
    expect(
      database.getFirstSync<{ id: string }>(
        'SELECT id FROM execution_runs WHERE id = ?',
        lease.runId,
      ),
    ).toEqual({ id: lease.runId });
  });

  it('lists pending generations in bounded creation order', async () => {
    const first = await begin();
    const secondOptions = {
      ...options(11),
      generateId: (() => {
        let sequence = 0;
        return () => `second-${++sequence}`;
      })(),
    };
    const secondCreated = await createForegroundModelExecution(
      {
        runId: 'run-2',
        conversationId: 'conversation-2',
        requestMessageId: 'request-2',
        assistantMessageId: 'assistant-2',
        requestState: {},
        modelState: {},
      },
      secondOptions,
    );
    const second = await activateForegroundModelExecution({ lease: secondCreated }, secondOptions);
    expect(listPendingForegroundModelExecutions({ limit: 1 })).toEqual([first]);
    expect(listPendingForegroundModelExecutions({ limit: 2 })).toEqual([first, second]);
    expect(
      listPendingForegroundModelExecutions({
        limit: 2,
        after: { createdAt: first.createdAt, runId: first.runId },
      }),
    ).toEqual([second]);
    expect(() => listPendingForegroundModelExecutions({ limit: 65 })).toThrow(
      'foreground_model_journal_invalid_limit',
    );
  });
});
