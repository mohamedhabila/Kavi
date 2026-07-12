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
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
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
