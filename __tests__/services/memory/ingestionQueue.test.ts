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
  enqueueIngestionJob,
  getIngestionQueueDiagnostics,
  getIngestionJob,
  INGESTION_RETRY_BASE_DELAY_MS,
  listPendingIngestionJobs,
  scheduleIngestionDrain,
} from '../../../src/services/memory/ingestionQueue';
import { resolveConsolidationPath } from '../../../src/services/memory/consolidation/paths';
import { processIngestionTurn } from '../../../src/services/memory/turnProcessor';
import { getWorkingBlock } from '../../../src/services/memory/workingBlocks';
import { __resetOnDeviceGuardsForTests } from '../../../src/services/memory/onDeviceGuards';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/sqlite-store';
import type { Message } from '../../../src/types/message';
import type { LlmProviderConfig } from '../../../src/types/provider';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const mockedResolveConsolidationPath = resolveConsolidationPath as jest.MockedFunction<
  typeof resolveConsolidationPath
>;
const mockedProcessIngestionTurn = processIngestionTurn as jest.MockedFunction<
  typeof processIngestionTurn
>;

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
  it('enqueues and deduplicates pending jobs for the same turn', () => {
    const first = enqueueIngestionJob({
      threadId: 'conv-1',
      sourceEndMessageId: 'assistant-1',
      sourceStartMessageId: 'user-1',
    });
    const second = enqueueIngestionJob({
      threadId: 'conv-1',
      sourceEndMessageId: 'assistant-1',
      sourceStartMessageId: 'user-1',
    });

    expect(first?.id).toBeTruthy();
    expect(second?.id).toBe(first?.id);
    expect(listPendingIngestionJobs()).toHaveLength(1);
  });

  it('does not re-enqueue a source turn after durable completion', async () => {
    const first = enqueueIngestionJob({
      threadId: 'conv-completed-dedupe',
      sourceStartMessageId: 'user-completed-dedupe',
      sourceEndMessageId: 'assistant-completed-dedupe',
      now: 100,
    });
    await drainIngestionQueue({
      loadMessagesForThread: () => closedTurn('completed-dedupe'),
      now: 100,
    });

    const replay = enqueueIngestionJob({
      threadId: 'conv-completed-dedupe',
      sourceStartMessageId: 'user-completed-dedupe',
      sourceEndMessageId: 'assistant-completed-dedupe',
      now: 200,
    });

    expect(replay).toEqual(
      expect.objectContaining({ id: first!.id, status: 'completed_structural' }),
    );
    expect(getIngestionQueueDiagnostics().total).toBe(1);
  });

  it('keeps the source thread separate from the memory namespace while draining', async () => {
    const job = enqueueIngestionJob({
      threadId: 'child-conv-1',
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
      threadTitle: 'Shared workspace',
    });

    expect(result.completed).toBe(1);
    expect(job?.threadId).toBe('child-conv-1');
    expect(job?.memoryConversationId).toBe('parent-conv-1');
    expect(loadMessagesForThread).toHaveBeenCalledWith('child-conv-1');
    expect(mockedProcessIngestionTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'child-conv-1',
        memoryConversationId: 'parent-conv-1',
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
      expect.objectContaining({ attempted: 1, completed: 0, deferred: 1, failed: 0 }),
    );
    expect(mockedProcessIngestionTurn).not.toHaveBeenCalled();
    expect(getIngestionJob(job!.id)).toEqual(
      expect.objectContaining({
        status: 'pending',
        attemptCount: 0,
        providerOutcome: null,
        outcomeCode: null,
      }),
    );
  });

  it('schedules processing failures for a deterministic bounded retry', async () => {
    mockedProcessIngestionTurn.mockRejectedValueOnce(new Error('Provider timeout'));
    const job = enqueueIngestionJob({
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

  it('forwards active chat provider context into consolidation', async () => {
    const provider: LlmProviderConfig = {
      id: 'active-provider',
      name: 'Active Provider',
      baseUrl: 'https://api.example.test',
      apiKey: 'test-key',
      model: 'model-test',
      enabled: true,
    };
    const job = enqueueIngestionJob({
      threadId: 'conv-provider',
      sourceEndMessageId: 'assistant-provider',
    });
    const messages: Message[] = [
      {
        id: 'user-provider',
        role: 'user',
        content: 'Remember this',
        createdAt: 1,
      },
      {
        id: 'assistant-provider',
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

    await drainIngestionQueue({
      loadMessagesForThread: () => messages,
      activeChatProvider: provider,
    });

    expect(job).not.toBeNull();
    expect(mockedResolveConsolidationPath).toHaveBeenCalledWith(provider);
  });

  it('keeps provider enrichment scoped to each queued job', async () => {
    const provider: LlmProviderConfig = {
      id: 'active-provider',
      name: 'Active Provider',
      baseUrl: 'https://api.example.test',
      apiKey: 'test-key',
      model: 'model-test',
      enabled: true,
    };
    const job = enqueueIngestionJob({
      threadId: 'conv-structural',
      sourceEndMessageId: 'assistant-structural',
      providerEnrichment: false,
    });
    const messages: Message[] = [
      {
        id: 'user-structural',
        role: 'user',
        content: 'Remember this',
        createdAt: 1,
      },
      {
        id: 'assistant-structural',
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

    await drainIngestionQueue({
      loadMessagesForThread: () => messages,
      activeChatProvider: provider,
    });

    expect(job?.providerEnrichment).toBe(false);
    expect(mockedResolveConsolidationPath).not.toHaveBeenCalled();
    expect(mockedProcessIngestionTurn).toHaveBeenCalledWith(
      expect.not.objectContaining({
        extractor: expect.any(Function),
      }),
    );
  });

  it('forwards thread title through scheduled drains', async () => {
    const job = enqueueIngestionJob({
      threadId: 'conv-scheduled-title',
      sourceEndMessageId: 'assistant-scheduled-title',
    });
    const messages: Message[] = [
      {
        id: 'user-scheduled-title',
        role: 'user',
        content: 'Remember this',
        createdAt: 1,
      },
      {
        id: 'assistant-scheduled-title',
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

    scheduleIngestionDrain(() => messages, undefined, undefined, 'longmem-delayed-thread');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(job).not.toBeNull();
    expect(getIngestionJob(job!.id)?.status).toBe('completed_structural');
    expect(mockedProcessIngestionTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'conv-scheduled-title',
        threadTitle: 'longmem-delayed-thread',
      }),
    );
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-scheduled-title',
        threadId: 'conv-scheduled-title',
      })?.content,
    ).toBe('longmem-delayed-thread');
  });
});
