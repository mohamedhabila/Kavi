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

import { resolveConsolidationPath } from '../../../src/services/memory/consolidation/paths';
import {
  __resetIngestionQueueForTests,
  drainIngestionQueue,
  enqueueIngestionJob as enqueueStrictIngestionJob,
  getIngestionJob,
  scheduleIngestionDrain,
} from '../../../src/services/memory/ingestionQueue';
import type { EnqueueIngestionJobInput } from '../../../src/services/memory/ingestionQueue';
import { __resetOnDeviceGuardsForTests } from '../../../src/services/memory/onDeviceGuards';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/database';
import { processIngestionTurn } from '../../../src/services/memory/turnProcessor';
import { getWorkingBlock } from '../../../src/services/memory/workingBlocks';
import type { Message } from '../../../src/types/message';
import type { LlmProviderConfig } from '../../../src/types/provider';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const mockedResolveConsolidationPath = resolveConsolidationPath as jest.MockedFunction<
  typeof resolveConsolidationPath
>;
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

function closedTurn(suffix: string): Message[] {
  return [
    {
      id: `user-${suffix}`,
      role: 'user',
      content: 'Remember this',
      timestamp: 1,
    },
    {
      id: `assistant-${suffix}`,
      role: 'assistant',
      content: 'Done',
      timestamp: 2,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      },
    },
  ];
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
  __resetIngestionQueueForTests();
  closeMemoryDb();
});

describe('ingestion queue runtime context', () => {
  it('deduplicates only an exact source identity and rejects conflicting provenance', () => {
    const source = {
      personaId: 'default',
      threadId: 'source-thread',
      threadTitle: 'Source thread',
      memoryConversationId: 'memory-root',
      taskId: 'task-1',
      sourceStartMessageId: 'user-1',
      sourceEndMessageId: 'assistant-1',
      sourceRunId: 'run-1',
      sourceAt: 10,
      chatProviderId: 'provider-1',
      chatModel: 'model-1',
      reason: 'turn_completed' as const,
      providerEnrichment: true,
      now: 20,
    } as const;
    const first = enqueueIngestionJob(source);
    expect(enqueueIngestionJob({ ...source, now: 30 })?.id).toBe(first?.id);

    const conflicts = [
      { memoryConversationId: 'other-memory-root' },
      { personaId: 'other-persona' },
      { taskId: 'other-task' },
      { sourceStartMessageId: 'other-user' },
      { sourceRunId: 'other-run' },
      { sourceAt: 11 },
      { threadTitle: 'Other source thread' },
      { chatProviderId: 'provider-2' },
      { chatModel: 'model-2' },
      { reason: 'manual' as const },
      { providerEnrichment: false },
    ];
    for (const conflict of conflicts) {
      expect(() => enqueueIngestionJob({ ...source, ...conflict, now: 40 })).toThrow(
        'memory_ingestion_source_identity_conflict',
      );
    }
    expect(getIngestionJob(first!.id)).toMatchObject({
      memoryConversationId: 'memory-root',
      personaId: 'default',
      taskId: 'task-1',
      sourceStartMessageId: 'user-1',
      sourceRunId: 'run-1',
      sourceAt: 10,
    });
  });

  it('rejects invalid source clocks instead of silently replacing them', () => {
    for (const sourceAt of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
      expect(() =>
        enqueueStrictIngestionJob({
          threadTitle: null,
          memoryConversationId: 'invalid-source-clock',
          personaId: 'default',
          threadId: 'invalid-source-clock',
          taskId: null,
          sourceStartMessageId: null,
          sourceEndMessageId: 'assistant-invalid-source-clock',
          sourceRunId: null,
          sourceAt,
          chatProviderId: null,
          chatModel: null,
          reason: 'turn_completed',
          providerEnrichment: true,
          now: 20,
        }),
      ).toThrow('memory_ingestion_source_timestamp_invalid');
    }
  });

  it('binds runtime provider credentials to the sealed provider and model', async () => {
    const provider: LlmProviderConfig = {
      id: 'active-provider',
      name: 'Active Provider',
      baseUrl: 'https://api.example.test',
      apiKey: 'test-key',
      model: 'mutable-runtime-model',
      enabled: true,
    };
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-provider',
      sourceEndMessageId: 'assistant-provider',
      chatProviderId: provider.id,
      chatModel: 'sealed-source-model',
    });

    await drainIngestionQueue({
      loadMessagesForThread: () => closedTurn('provider'),
      loadRuntimeContextForJob: () => ({ activeChatProvider: provider }),
    });

    expect(job).not.toBeNull();
    expect(mockedResolveConsolidationPath).toHaveBeenCalledWith(
      { ...provider, model: 'sealed-source-model' },
      {
        requireExplicitChatProvider: true,
      },
    );
  });

  it('does not substitute a different runtime provider for a sealed source provider', async () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-provider-mismatch',
      sourceEndMessageId: 'assistant-provider-mismatch',
      chatProviderId: 'sealed-provider',
      chatModel: 'sealed-model',
    });

    await drainIngestionQueue({
      loadMessagesForThread: () => closedTurn('provider-mismatch'),
      loadRuntimeContextForJob: () => ({
        activeChatProvider: {
          id: 'different-provider',
          name: 'Different Provider',
          baseUrl: 'https://api.example.test',
          apiKey: 'test-key',
          model: 'different-model',
          enabled: true,
        },
      }),
    });

    expect(job).not.toBeNull();
    expect(mockedResolveConsolidationPath).toHaveBeenCalledWith(undefined, {
      requireExplicitChatProvider: true,
    });
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
      personaId: 'default',
      threadId: 'conv-structural',
      sourceEndMessageId: 'assistant-structural',
      providerEnrichment: false,
    });

    await drainIngestionQueue({
      loadMessagesForThread: () => closedTurn('structural'),
      loadRuntimeContextForJob: () => ({ activeChatProvider: provider }),
    });

    expect(job?.providerEnrichment).toBe(false);
    expect(mockedResolveConsolidationPath).not.toHaveBeenCalled();
    expect(mockedProcessIngestionTurn).toHaveBeenCalledWith(
      expect.not.objectContaining({
        extractor: expect.any(Function),
      }),
    );
  });

  it('uses the sealed thread title through scheduled drains', async () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-scheduled-title',
      threadTitle: 'longmem-delayed-thread',
      sourceEndMessageId: 'assistant-scheduled-title',
    });

    scheduleIngestionDrain({
      loadMessagesForThread: () => closedTurn('scheduled-title'),
    });
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
