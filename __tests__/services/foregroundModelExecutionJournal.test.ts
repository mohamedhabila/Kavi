jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  beginForegroundModelExecution,
  completeForegroundModelExecution,
  listPendingForegroundModelExecutions,
} from '../../src/services/executionJournal/foregroundModelExecutionJournal';
import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import { appendExecutionCheckpoint } from '../../src/services/executionJournal/mutations';

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
  return beginForegroundModelExecution(
    {
      conversationId: 'conversation-1',
      requestMessageId: 'request-1',
      assistantMessageId: 'assistant-1',
      taskId: 'task-1',
      requestState: { messages: ['private request text'] },
      modelState: { providerId: 'provider-1', model: 'model-1' },
    },
    options(),
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

describe('foreground model execution journal', () => {
  it('creates a non-resumable running generation before model execution', async () => {
    const lease = await begin();
    const database = getExecutionJournalDb();

    expect(lease).toEqual({
      runId: 'foreground-model-id-1',
      conversationId: 'conversation-1',
      requestMessageId: 'request-1',
      assistantMessageId: 'assistant-1',
      taskId: 'task-1',
      expectedStatus: 'running',
      controlEpoch: 0,
      updatedAt: 10,
      checkpointId: 'foreground-before-model-id-3',
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
    ).rejects.toThrow('foreground_model_journal_generation_changed');
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
    ).rejects.toThrow('foreground_model_journal_generation_changed');
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

  it('lists pending generations in bounded creation order', async () => {
    const first = await begin();
    const second = await beginForegroundModelExecution(
      {
        conversationId: 'conversation-2',
        requestMessageId: 'request-2',
        assistantMessageId: 'assistant-2',
        requestState: {},
        modelState: {},
      },
      {
        ...options(11),
        generateId: (() => {
          let sequence = 0;
          return () => `second-${++sequence}`;
        })(),
      },
    );
    expect(listPendingForegroundModelExecutions(1)).toEqual([first]);
    expect(listPendingForegroundModelExecutions(2)).toEqual([first, second]);
    expect(() => listPendingForegroundModelExecutions(65)).toThrow(
      'foreground_model_journal_invalid_limit',
    );
  });
});
