jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../../src/services/memory/consolidation/paths', () => ({
  resolveConsolidationPath: jest.fn(async () => ({
    tier: 'deterministic',
    provider: null,
    model: null,
    extractor: null,
  })),
}));

jest.mock('../../../src/services/memory/turnProcessor', () => ({
  processIngestionTurn: jest.fn(async () => ({
    processed: true,
    episodeId: 'ep-1',
    deterministicFactIds: ['fact-1'],
    providerFactIds: [],
    invalidatedFactIds: [],
    activeFocusUpdated: true,
    openThreadsUpdated: false,
    enriched: false,
    providerOutcome: { status: 'not_requested' },
  })),
}));

import {
  __resetIngestionQueueForTests,
  drainIngestionQueue,
  enqueueIngestionJob as enqueueStrictIngestionJob,
  getIngestionJob,
  INGESTION_RETRY_BASE_DELAY_MS,
  listPendingIngestionJobs,
  processIngestionJob,
} from '../../../src/services/memory/ingestionQueue';
import type { EnqueueIngestionJobInput } from '../../../src/services/memory/ingestionQueue';
import { getIngestionQueueDiagnostics } from '../../../src/services/memory/ingestionQueueDiagnostics';
import { ensureIngestionQueueSchema } from '../../../src/services/memory/ingestionQueueSchema';
import { processIngestionTurn } from '../../../src/services/memory/turnProcessor';
import { getWorkingBlock } from '../../../src/services/memory/workingBlocks';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { recordEpisode } from '../../../src/services/memory/episodes/mutations';
import { __resetOnDeviceGuardsForTests } from '../../../src/services/memory/onDeviceGuards';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/sqlite-store';
import type { Message } from '../../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const mockedProcessIngestionTurn = processIngestionTurn as jest.MockedFunction<
  typeof processIngestionTurn
>;

type TestEnqueueInput = Pick<
  EnqueueIngestionJobInput,
  'personaId' | 'threadId' | 'sourceEndMessageId'
> &
  Partial<EnqueueIngestionJobInput>;

function enqueueIngestionJob(input: TestEnqueueInput) {
  return enqueueStrictIngestionJob({
    threadTitle: null,
    memoryConversationId: input.threadId,
    taskId: null,
    sourceStartMessageId: null,
    sourceRunId: null,
    sourceAt: input.sourceAt ?? input.now ?? 1,
    chatProviderId: null,
    chatModel: null,
    reason: 'turn_completed',
    providerEnrichment: true,
    ...input,
  });
}

function processResult(
  providerOutcome: Awaited<ReturnType<typeof processIngestionTurn>>['providerOutcome'],
): Awaited<ReturnType<typeof processIngestionTurn>> {
  return {
    processed: true,
    episodeId: 'ep-1',
    deterministicFactIds: ['fact-1'],
    providerFactIds: [],
    invalidatedFactIds: [],
    activeFocusUpdated: true,
    openThreadsUpdated: false,
    enriched: providerOutcome.status === 'valid',
    providerOutcome,
    bridgedEvidenceFactIds: [],
    agentRunMemoryFactIds: [],
  };
}

function closedTurn(suffix: string): Message[] {
  return [
    {
      id: `user-${suffix}`,
      role: 'user',
      content: 'Remember this',
      createdAt: 1,
    },
    {
      id: `assistant-${suffix}`,
      role: 'assistant',
      content: 'Done',
      createdAt: 2,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      },
    },
  ];
}

function columnNamesForQueue(): string[] {
  return getMemoryDb()
    .getAllSync<{ name: string }>('PRAGMA table_info(memory_ingestion_jobs)')
    .map((column) => column.name);
}

beforeEach(() => {
  jest.clearAllMocks();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  __resetOnDeviceGuardsForTests();
  __resetIngestionQueueForTests();
});

afterEach(() => {
  closeMemoryDb();
});

describe('ingestionQueue', () => {
  it('requires exact sealed identity and never normalizes an invalid enqueue', () => {
    const valid = {
      threadTitle: null,
      memoryConversationId: 'conv-valid',
      personaId: 'default',
      threadId: 'conv-valid',
      taskId: null,
      sourceStartMessageId: null,
      sourceEndMessageId: 'assistant-valid',
      sourceRunId: null,
      sourceAt: 1,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed' as const,
      providerEnrichment: true,
      now: 1,
    };
    expect(() =>
      enqueueStrictIngestionJob({
        ...valid,
        personaId: '',
        threadId: 'conv-invalid-persona',
        memoryConversationId: 'conv-invalid-persona',
        sourceEndMessageId: 'assistant-invalid-persona',
      }),
    ).toThrow('memory_ingestion_persona_scope_invalid');
    expect(() =>
      enqueueStrictIngestionJob({
        ...valid,
        personaId: undefined,
        threadId: 'conv-missing-persona',
        memoryConversationId: 'conv-missing-persona',
        sourceEndMessageId: 'assistant-missing-persona',
      } as never),
    ).toThrow('memory_ingestion_persona_scope_invalid');
    expect(() =>
      enqueueStrictIngestionJob({
        ...valid,
        personaId: 'default',
        threadId: ' conv-invalid-thread ',
        sourceEndMessageId: 'assistant-invalid-thread',
      }),
    ).toThrow('memory_ingestion_thread_scope_invalid');
    expect(() =>
      enqueueStrictIngestionJob({
        ...valid,
        personaId: 'default',
        threadId: 'conv-invalid-task',
        memoryConversationId: 'conv-invalid-task',
        taskId: ' task-invalid ',
        sourceEndMessageId: 'assistant-invalid-task',
      }),
    ).toThrow('memory_ingestion_task_scope_invalid');
    expect(() =>
      enqueueStrictIngestionJob({
        ...valid,
        personaId: 'default',
        threadId: 'conv-invalid-source',
        memoryConversationId: 'conv-invalid-source',
        sourceEndMessageId: ' assistant-invalid-source ',
      }),
    ).toThrow('memory_ingestion_source_end_invalid');
    expect(getIngestionQueueDiagnostics().total).toBe(0);
  });

  it('fails old unsealed active jobs closed while preserving completed terminal status', async () => {
    const jobs = ['pending', 'retrying', 'processing', 'completed'].map((suffix) =>
      enqueueIngestionJob({
        personaId: 'default',
        threadId: `legacy-${suffix}`,
        sourceStartMessageId: `user-legacy-${suffix}`,
        sourceEndMessageId: `assistant-legacy-${suffix}`,
        now: 1,
      }),
    );
    expect(jobs.every(Boolean)).toBe(true);
    const [pending, retrying, processing, completed] = jobs as Array<
      NonNullable<(typeof jobs)[number]>
    >;
    getMemoryDb().runSync(
      'UPDATE memory_ingestion_jobs SET persona_id = NULL WHERE id = ?',
      pending.id,
    );
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs
          SET persona_id = NULL, status = 'retrying', next_attempt_at = 1
        WHERE id = ?`,
      retrying.id,
    );
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs
          SET persona_id = NULL, status = 'processing', next_attempt_at = NULL,
              claim_token = 'legacy-claim', lease_expires_at = 100
        WHERE id = ?`,
      processing.id,
    );
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs
          SET persona_id = NULL, status = 'completed_structural', next_attempt_at = NULL,
              provider_outcome = 'structural_only', structural_completed_at = 1,
              completed_at = 1
        WHERE id = ?`,
      completed.id,
    );

    ensureIngestionQueueSchema(getMemoryDb());

    for (const job of [pending, retrying, processing]) {
      expect(getIngestionJob(job.id)).toMatchObject({
        status: 'failed',
        personaId: null,
        outcomeCode: 'persona_scope_missing',
      });
    }
    expect(getIngestionJob(completed.id)).toMatchObject({
      status: 'completed_structural',
      personaId: null,
      outcomeCode: null,
    });
    await expect(
      processIngestionJob({
        jobId: completed.id,
        messages: closedTurn('legacy-completed'),
        now: 2,
      }),
    ).resolves.toMatchObject({
      processed: false,
      status: 'completed_structural',
      skipped: 'missing_or_terminal',
    });
  });

  it('terminal-fails a corrupted persisted persona instead of retrying or adopting it', async () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'corrupt-persona-job',
      sourceStartMessageId: 'user-corrupt-persona',
      sourceEndMessageId: 'assistant-corrupt-persona',
      now: 1,
    });
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs SET persona_id = ? WHERE id = ?`,
      'corrupt\u0001persona',
      job!.id,
    );

    await expect(
      processIngestionJob({
        jobId: job!.id,
        messages: closedTurn('corrupt-persona'),
        now: 2,
      }),
    ).resolves.toMatchObject({
      processed: false,
      status: 'failed',
      skipped: 'persona_scope_missing',
    });
    expect(getIngestionJob(job!.id)).toMatchObject({
      status: 'failed',
      personaId: null,
      outcomeCode: 'persona_scope_missing',
    });
  });

  it.each([
    ['id', ' corrupt-job-id '],
    ['thread_id', ' corrupt-thread '],
    ['thread_title', 'corrupt\u0001title'],
    ['memory_conversation_id', ' corrupt-root '],
    ['task_id', ' corrupt-task '],
    ['source_run_id', 'corrupt\u0001run'],
    ['source_start_message_id', 'corrupt\u0001start'],
    ['source_end_message_id', 'corrupt\u0001end'],
    ['source_at', 1.5],
  ] as const)(
    'terminal-fails a post-startup %s identity corruption before consolidation',
    async (column, corruptValue) => {
      const suffix = `corrupt-${column}`;
      const job = enqueueIngestionJob({
        personaId: 'default',
        threadId: `thread-${suffix}`,
        sourceStartMessageId: `user-${suffix}`,
        sourceEndMessageId: `assistant-${suffix}`,
        now: 1,
      })!;
      getMemoryDb().runSync(
        `UPDATE memory_ingestion_jobs SET ${column} = ? WHERE id = ?`,
        corruptValue,
        job.id,
      );
      const persistedId = column === 'id' ? String(corruptValue) : job.id;

      await expect(
        processIngestionJob({
          jobId: persistedId,
          messages: closedTurn(suffix),
          now: 2,
        }),
      ).resolves.toEqual({
        processed: false,
        status: 'failed',
        skipped: 'source_identity_invalid',
      });
      expect(mockedProcessIngestionTurn).not.toHaveBeenCalled();
      expect(
        getMemoryDb().getFirstSync<{ status: string; outcome_code: string }>(
          'SELECT status, outcome_code FROM memory_ingestion_jobs WHERE id = ?',
          persistedId,
        ),
      ).toEqual({ status: 'failed', outcome_code: 'source_identity_invalid' });
    },
  );

  it('quarantines corrupt due jobs before loading their source messages', async () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'corrupt-before-load',
      sourceStartMessageId: 'user-corrupt-before-load',
      sourceEndMessageId: 'assistant-corrupt-before-load',
      now: 1,
    })!;
    getMemoryDb().runSync(
      'UPDATE memory_ingestion_jobs SET memory_conversation_id = ? WHERE id = ?',
      ' corrupt-root ',
      job.id,
    );
    const loadMessagesForThread = jest.fn(() => closedTurn('corrupt-before-load'));

    await expect(drainIngestionQueue({ loadMessagesForThread, now: 2 })).resolves.toMatchObject({
      attempted: 0,
    });
    expect(loadMessagesForThread).not.toHaveBeenCalled();
    expect(getIngestionJob(job.id)).toMatchObject({
      status: 'failed',
      outcomeCode: 'source_identity_invalid',
    });
  });

  it('enforces provider pairing, reason, and enrichment policy in storage', () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'storage-contract',
      sourceEndMessageId: 'assistant-storage-contract',
      now: 1,
    })!;
    expect(() =>
      getMemoryDb().runSync(
        'UPDATE memory_ingestion_jobs SET chat_provider_id = ? WHERE id = ?',
        'provider-without-model',
        job.id,
      ),
    ).toThrow();
    expect(() =>
      getMemoryDb().runSync(
        'UPDATE memory_ingestion_jobs SET reason = ? WHERE id = ?',
        'unknown_reason',
        job.id,
      ),
    ).toThrow();
    expect(() =>
      getMemoryDb().runSync(
        'UPDATE memory_ingestion_jobs SET provider_enrichment = ? WHERE id = ?',
        2,
        job.id,
      ),
    ).toThrow();
  });

  it('quarantines source-derived memory when persisted duplicate identities conflict', () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conflicting-source-thread',
      memoryConversationId: 'conflicting-root-a',
      sourceStartMessageId: 'conflicting-source-user',
      sourceEndMessageId: 'conflicting-source-assistant',
      sourceRunId: 'conflicting-source-run',
      sourceAt: 10,
      now: 10,
    })!;
    const subject = upsertEntity({ name: 'conflicting source', type: 'project', now: 10 });
    const fact = recordFact({
      subjectId: subject.id,
      predicate: 'release_state',
      objectText: 'ambiguous result',
      scope: 'conversation',
      originConversationId: 'conflicting-root-a',
      originThreadId: 'conflicting-source-thread',
      sourceMessageId: 'conflicting-source-user',
      sourceRunId: 'conflicting-source-run',
      sourceTurnId: 'conflicting-source-assistant',
      now: 10,
    }).fact;
    const episode = recordEpisode({
      conversationId: 'conflicting-root-a',
      threadId: 'conflicting-source-thread',
      taskId: null,
      summary: 'Ambiguous source-derived episode.',
      messageIds: ['conflicting-source-user', 'conflicting-source-assistant'],
      sourceStartMessageId: 'conflicting-source-user',
      sourceEndMessageId: 'conflicting-source-assistant',
      accessPolicy: {
        memoryConversationId: 'conflicting-root-a',
        sourceThreadId: 'conflicting-source-thread',
        personaId: 'default',
        taskId: null,
        shareability: 'thread_only',
        sensitivity: 'normal',
      },
      now: 10,
    })!;
    const unrelatedEpisode = recordEpisode({
      conversationId: 'unrelated-root',
      threadId: 'unrelated-thread',
      taskId: null,
      summary: 'Unrelated episode remains available.',
      messageIds: ['unrelated-user', 'unrelated-assistant'],
      sourceStartMessageId: 'unrelated-user',
      sourceEndMessageId: 'unrelated-assistant',
      accessPolicy: {
        memoryConversationId: 'unrelated-root',
        sourceThreadId: 'unrelated-thread',
        personaId: 'default',
        taskId: null,
        shareability: 'thread_only',
        sensitivity: 'normal',
      },
      now: 10,
    })!;
    const db = getMemoryDb();
    db.execSync('DROP INDEX idx_ingestion_jobs_source_turn');
    db.runSync(
      `INSERT INTO memory_ingestion_jobs(
         id, thread_id, thread_title, memory_conversation_id, persona_id, task_id,
         source_run_id, chat_provider_id, chat_model, source_start_message_id,
         source_end_message_id, source_at, reason, status, attempt_count,
         provider_enrichment, provider_outcome, outcome_code, next_attempt_at,
         lease_expires_at, claim_token, structural_completed_at, created_at, updated_at,
         completed_at
       )
       SELECT ?, thread_id, thread_title, ?, persona_id, task_id, source_run_id,
              chat_provider_id, chat_model, source_start_message_id, source_end_message_id,
              source_at, reason, status, attempt_count, provider_enrichment,
              provider_outcome, outcome_code, next_attempt_at, lease_expires_at,
              claim_token, structural_completed_at, created_at, updated_at, completed_at
         FROM memory_ingestion_jobs
        WHERE id = ?`,
      'conflicting-source-job-b',
      'conflicting-root-b',
      job.id,
    );

    ensureIngestionQueueSchema(db);

    expect(
      db.getAllSync<{ status: string; outcome_code: string }>(
        `SELECT status, outcome_code
           FROM memory_ingestion_jobs
          WHERE thread_id = 'conflicting-source-thread'`,
      ),
    ).toEqual([{ status: 'failed', outcome_code: 'source_identity_conflict' }]);
    expect(
      db.getFirstSync<{ deleted_at: number | null }>(
        'SELECT deleted_at FROM memory_episodes WHERE id = ?',
        episode.id,
      )?.deleted_at,
    ).not.toBeNull();
    expect(
      db.getFirstSync(
        'SELECT episode_id FROM memory_episode_access_policies WHERE episode_id = ?',
        episode.id,
      ),
    ).toBeNull();
    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_episode_terms WHERE episode_id = ?',
        episode.id,
      )?.count,
    ).toBe(0);
    expect(
      db.getFirstSync<{ deleted_at: number | null }>(
        'SELECT deleted_at FROM memory_facts WHERE id = ?',
        fact.id,
      )?.deleted_at,
    ).not.toBeNull();
    expect(
      db.getFirstSync<{ deleted_at: number | null }>(
        'SELECT deleted_at FROM memory_episodes WHERE id = ?',
        unrelatedEpisode.id,
      )?.deleted_at,
    ).toBeNull();
    expect(
      db.getFirstSync(
        'SELECT episode_id FROM memory_episode_access_policies WHERE episode_id = ?',
        unrelatedEpisode.id,
      ),
    ).toEqual({ episode_id: unrelatedEpisode.id });
  });

  it('enqueues and deduplicates pending jobs for the same turn', () => {
    const first = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-1',
      sourceEndMessageId: 'assistant-1',
      sourceStartMessageId: 'user-1',
      sourceAt: 2,
    });
    const second = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-1',
      sourceEndMessageId: 'assistant-1',
      sourceStartMessageId: 'user-1',
      sourceAt: 2,
    });

    expect(first?.id).toBeTruthy();
    expect(second?.id).toBe(first?.id);
    expect(listPendingIngestionJobs()).toHaveLength(1);
  });

  it('does not re-enqueue a source turn after durable completion', async () => {
    const first = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-completed-dedupe',
      sourceStartMessageId: 'user-completed-dedupe',
      sourceEndMessageId: 'assistant-completed-dedupe',
      sourceAt: 2,
      now: 100,
    });
    await drainIngestionQueue({
      loadMessagesForThread: () => closedTurn('completed-dedupe'),
      now: 100,
    });

    const replay = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-completed-dedupe',
      sourceStartMessageId: 'user-completed-dedupe',
      sourceEndMessageId: 'assistant-completed-dedupe',
      sourceAt: 2,
      now: 200,
    });

    expect(replay).toEqual(
      expect.objectContaining({ id: first!.id, status: 'completed_structural' }),
    );
    expect(getIngestionQueueDiagnostics().total).toBe(1);
  });

  it('keeps the source thread separate from the memory namespace while draining', async () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'child-conv-1',
      threadTitle: 'Shared workspace',
      memoryConversationId: 'parent-conv-1',
      sourceEndMessageId: 'assistant-1',
      sourceStartMessageId: 'user-1',
    });
    const messages: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Record this memory.',
        createdAt: 1,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Done',
        createdAt: 2,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'stop',
        },
      },
    ];
    const loadMessagesForThread = jest.fn((threadId: string) =>
      threadId === 'child-conv-1' ? messages : [],
    );

    const result = await drainIngestionQueue({
      loadMessagesForThread,
    });

    expect(result.completed).toBe(1);
    expect(job?.threadId).toBe('child-conv-1');
    expect(job?.memoryConversationId).toBe('parent-conv-1');
    expect(loadMessagesForThread).toHaveBeenCalledWith('child-conv-1');
    expect(mockedProcessIngestionTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'child-conv-1',
        memoryConversationId: 'parent-conv-1',
        episodeAccess: { personaId: 'default', shareability: 'thread_only' },
      }),
    );
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'parent-conv-1',
        threadId: 'parent-conv-1',
      })?.content,
    ).toBe('Shared workspace');
  });

  it('drains pending jobs and marks them completed', async () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-1',
      sourceEndMessageId: 'assistant-1',
    });
    expect(job).not.toBeNull();

    const messages: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Remember this',
        createdAt: 1,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Done',
        createdAt: 2,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'stop',
        },
      },
    ];

    const result = await drainIngestionQueue({
      loadMessagesForThread: () => messages,
    });

    expect(result.attempted).toBe(1);
    expect(result.completed).toBe(1);
    expect(mockedProcessIngestionTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeAccess: { personaId: 'default', shareability: 'thread_only' },
      }),
    );
    expect(getIngestionJob(job!.id)).toEqual(
      expect.objectContaining({
        status: 'completed_structural',
        providerOutcome: 'structural_only',
        outcomeCode: null,
        structuralCompletedAt: expect.any(Number),
      }),
    );
  });

  it('defers a job when its recorded source window is not loaded', async () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-missing-window',
      sourceStartMessageId: 'user-missing',
      sourceEndMessageId: 'assistant-missing',
    });
    const latestTurn: Message[] = [
      {
        id: 'user-latest',
        role: 'user',
        content: 'This later turn must not replace the queued source window.',
        createdAt: 3,
      },
      {
        id: 'assistant-latest',
        role: 'assistant',
        content: 'Later response',
        createdAt: 4,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'stop',
        },
      },
    ];

    const result = await drainIngestionQueue({
      loadMessagesForThread: () => latestTurn,
    });

    expect(result).toEqual(
      expect.objectContaining({
        attempted: 1,
        completed: 0,
        retrying: 1,
        deferred: 0,
        sourceDeferred: 1,
        failed: 0,
      }),
    );
    expect(mockedProcessIngestionTurn).not.toHaveBeenCalled();
    expect(getIngestionJob(job!.id)).toEqual(
      expect.objectContaining({
        status: 'retrying',
        attemptCount: 1,
        providerOutcome: null,
        outcomeCode: 'source_window_unavailable',
      }),
    );
  });

  it('schedules processing failures for a deterministic bounded retry', async () => {
    mockedProcessIngestionTurn.mockRejectedValueOnce(new Error('Provider timeout'));
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-fail',
      sourceEndMessageId: 'assistant-fail',
    });
    const messages: Message[] = [
      {
        id: 'user-fail',
        role: 'user',
        content: 'Remember this',
        createdAt: 1,
      },
      {
        id: 'assistant-fail',
        role: 'assistant',
        content: 'Done',
        createdAt: 2,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'stop',
        },
      },
    ];

    const result = await drainIngestionQueue({
      loadMessagesForThread: () => messages,
    });

    expect(result.attempted).toBe(1);
    expect(result.completed).toBe(0);
    expect(result.retrying).toBe(1);
    expect(result.failed).toBe(0);
    expect(getIngestionJob(job!.id)).toEqual(
      expect.objectContaining({
        status: 'retrying',
        attemptCount: 1,
        providerOutcome: null,
        outcomeCode: 'processing_error',
        structuralCompletedAt: null,
      }),
    );
  });

  it.each(['valid', 'empty_valid'] as const)(
    'records %s provider validation separately from structural-only completion',
    async (providerStatus) => {
      mockedProcessIngestionTurn.mockResolvedValueOnce(processResult({ status: providerStatus }));
      const job = enqueueIngestionJob({
        personaId: 'default',
        threadId: `conv-${providerStatus}`,
        sourceStartMessageId: `user-${providerStatus}`,
        sourceEndMessageId: `assistant-${providerStatus}`,
        now: 100,
      });

      const result = await drainIngestionQueue({
        loadMessagesForThread: () => closedTurn(providerStatus),
        now: 100,
      });

      expect(result).toEqual(
        expect.objectContaining({
          attempted: 1,
          completed: 1,
          completedStructural: 0,
          completedEnriched: 1,
        }),
      );
      expect(getIngestionJob(job!.id)).toEqual(
        expect.objectContaining({
          status: 'completed_enriched',
          providerOutcome: providerStatus,
          outcomeCode: null,
          attemptCount: 1,
          structuralCompletedAt: 100,
        }),
      );
    },
  );

  it('retries malformed provider output with a deterministic due time', async () => {
    mockedProcessIngestionTurn.mockResolvedValueOnce(
      processResult({ status: 'malformed', code: 'invalid_json' }),
    );
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-malformed',
      sourceStartMessageId: 'user-malformed',
      sourceEndMessageId: 'assistant-malformed',
      now: 100,
    });

    const result = await drainIngestionQueue({
      loadMessagesForThread: () => closedTurn('malformed'),
      now: 100,
    });

    expect(result).toEqual(
      expect.objectContaining({ completed: 0, retrying: 1, degraded: 0, failed: 0 }),
    );
    expect(getIngestionJob(job!.id)).toEqual(
      expect.objectContaining({
        status: 'retrying',
        providerOutcome: 'malformed',
        outcomeCode: 'invalid_json',
        nextAttemptAt: 100 + INGESTION_RETRY_BASE_DELAY_MS,
        structuralCompletedAt: 100,
      }),
    );
    expect(listPendingIngestionJobs(3, 100 + INGESTION_RETRY_BASE_DELAY_MS - 1)).toHaveLength(0);
    expect(listPendingIngestionJobs(3, 100 + INGESTION_RETRY_BASE_DELAY_MS)).toEqual([
      expect.objectContaining({ id: job!.id }),
    ]);
  });

  it('degrades only after exactly the maximum provider attempts', async () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-degraded',
      sourceStartMessageId: 'user-degraded',
      sourceEndMessageId: 'assistant-degraded',
      now: 100,
    });
    let now = 100;

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      mockedProcessIngestionTurn.mockResolvedValueOnce(
        processResult({ status: 'schema_invalid', code: 'invalid_field_type' }),
      );
      const result = await drainIngestionQueue({
        loadMessagesForThread: () => closedTurn('degraded'),
        now,
      });
      const current = getIngestionJob(job!.id)!;
      expect(current.attemptCount).toBe(attempt);
      if (attempt < 5) {
        expect(current.status).toBe('retrying');
        expect(result.retrying).toBe(1);
        now = current.nextAttemptAt!;
      } else {
        expect(current).toEqual(
          expect.objectContaining({
            status: 'degraded',
            providerOutcome: 'schema_invalid',
            outcomeCode: 'invalid_field_type',
            nextAttemptAt: null,
            completedAt: now,
            structuralCompletedAt: 100,
          }),
        );
        expect(result.degraded).toBe(1);
      }
    }
  });

  it('fails after exactly the maximum processing attempts without persisting exception text', async () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-processing-failed',
      sourceStartMessageId: 'user-processing-failed',
      sourceEndMessageId: 'assistant-processing-failed',
      now: 100,
    });
    let now = 100;

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      mockedProcessIngestionTurn.mockRejectedValueOnce(
        new Error(`sensitive provider exception ${attempt}`),
      );
      const result = await drainIngestionQueue({
        loadMessagesForThread: () => closedTurn('processing-failed'),
        now,
      });
      const current = getIngestionJob(job!.id)!;
      expect(current.attemptCount).toBe(attempt);
      if (attempt < 5) {
        expect(current.status).toBe('retrying');
        now = current.nextAttemptAt!;
      } else {
        expect(current).toEqual(
          expect.objectContaining({
            status: 'failed',
            providerOutcome: null,
            outcomeCode: 'processing_error',
            nextAttemptAt: null,
          }),
        );
        expect(result.failed).toBe(1);
      }
    }
    expect(columnNamesForQueue()).not.toContain('error');
  });
});
