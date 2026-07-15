jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import {
  __resetIngestionQueueForTests,
  enqueueIngestionJob as enqueueStrictIngestionJob,
  getIngestionJob,
  listIngestionDurabilityReceipts,
  processIngestionJob,
} from '../../../src/services/memory/ingestionQueue';
import { encodeIngestionSourceSnapshot } from '../../../src/services/memory/ingestionSourceSnapshot';
import { __resetOnDeviceGuardsForTests } from '../../../src/services/memory/onDeviceGuards';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import * as workingBlocks from '../../../src/services/memory/workingBlocks';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import type { Message } from '../../../src/types/message';
import { createTestIngestionJobEnqueuer } from '../../helpers/ingestionSourceSnapshotFixture';
import { listFacts } from '../../../src/services/memory/facts/queries';
import { listEpisodes } from '../../../src/services/memory/episodes/queries';
import { getConsolidationState } from '../../../src/services/memory/consolidatorScheduler';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const enqueueIngestionJob = createTestIngestionJobEnqueuer(enqueueStrictIngestionJob);

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  __resetOnDeviceGuardsForTests();
  __resetIngestionQueueForTests();
  useSettingsStore.setState({
    disableLongTermMemory: false,
    consolidationProvider: '',
    providers: [],
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  __resetIngestionQueueForTests();
  closeMemoryDb();
});

it('publishes structural completion only after prompt-visible state is durable', async () => {
  const threadId = 'conversation-terminal-focus';
  const threadTitle = 'رحلة-نهاية-الأسبوع';
  const messages: Message[] = [
    { id: 'user-terminal-focus', role: 'user', content: 'خطة-٤٢', timestamp: 1 },
    {
      id: 'assistant-terminal-focus',
      role: 'assistant',
      content: 'تم',
      timestamp: 2,
      assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
    },
  ];
  const job = enqueueIngestionJob({
    personaId: 'default',
    threadId,
    threadTitle,
    memoryConversationId: threadId,
    taskId: null,
    sourceStartMessageId: messages[0]!.id,
    sourceEndMessageId: messages[1]!.id,
    sourceRunId: null,
    sourceAt: 2,
    chatProviderId: null,
    chatModel: null,
    reason: 'turn_completed',
    providerEnrichment: false,
    now: 100,
    sourceSnapshot: encodeIngestionSourceSnapshot({
      messages,
      priorUserMessageId: null,
      sourceStartMessageId: messages[0]!.id,
      sourceEndMessageId: messages[1]!.id,
    }),
  })!;

  const statusAtFocusWrite: Array<NonNullable<ReturnType<typeof getIngestionJob>>['status']> = [];
  const receiptsAtFocusWrite: number[] = [];
  const editFocus = workingBlocks.editPromptEligibleWorkingBlock;
  jest.spyOn(workingBlocks, 'editPromptEligibleWorkingBlock').mockImplementation((...args) => {
    statusAtFocusWrite.push(getIngestionJob(job.id)!.status);
    receiptsAtFocusWrite.push(listIngestionDurabilityReceipts(job.id).length);
    return editFocus(...args);
  });

  await expect(processIngestionJob({ jobId: job.id, now: 100 })).resolves.toEqual({
    processed: true,
    status: 'completed_structural',
  });
  expect(statusAtFocusWrite).toEqual(['processing']);
  expect(receiptsAtFocusWrite).toEqual([0]);
  expect(getIngestionJob(job.id)?.status).toBe('completed_structural');
  expect(listIngestionDurabilityReceipts(job.id)).toEqual([
    expect.objectContaining({
      phase: 'structural_checkpoint',
      activeFocusUpdated: true,
      source: expect.objectContaining({
        memoryConversationId: threadId,
        sourceThreadId: threadId,
        personaId: 'default',
        sourceStartMessageId: messages[0]!.id,
        sourceEndMessageId: messages[1]!.id,
        sourceSnapshotSha256: job.sourceSnapshotSha256,
      }),
    }),
    expect.objectContaining({
      phase: 'provider_final',
      activeFocusUpdated: true,
    }),
  ]);
  expect(
    workingBlocks.getWorkingBlock('active_focus', {
      conversationId: threadId,
      threadId,
    })?.content,
  ).toContain(threadTitle);
});

it('rolls back prompt state, memory, cursor, and both receipts when final transition fails', async () => {
  const threadId = 'conversation-terminal-rollback';
  const threadTitle = '計画-استرجاع';
  const messages: Message[] = [
    { id: 'user-terminal-rollback', role: 'user', content: 'قيمة-٤٢', timestamp: 1 },
    {
      id: 'assistant-terminal-rollback',
      role: 'assistant',
      content: '完了',
      timestamp: 2,
      assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
    },
  ];
  const job = enqueueIngestionJob({
    personaId: 'default',
    threadId,
    threadTitle,
    memoryConversationId: threadId,
    taskId: null,
    sourceStartMessageId: messages[0]!.id,
    sourceEndMessageId: messages[1]!.id,
    sourceRunId: null,
    sourceAt: 2,
    chatProviderId: null,
    chatModel: null,
    reason: 'turn_completed',
    providerEnrichment: false,
    now: 100,
    sourceSnapshot: encodeIngestionSourceSnapshot({
      messages,
      priorUserMessageId: null,
      sourceStartMessageId: messages[0]!.id,
      sourceEndMessageId: messages[1]!.id,
    }),
  })!;
  getMemoryDb().execSync(`
    CREATE TRIGGER reject_test_ingestion_terminal
      BEFORE UPDATE OF status ON memory_ingestion_jobs
      WHEN NEW.status = 'completed_structural'
      BEGIN
        SELECT RAISE(ABORT, 'forced_terminal_transition_failure');
      END;
  `);

  await expect(processIngestionJob({ jobId: job.id, now: 100 })).resolves.toEqual({
    processed: false,
    status: 'retrying',
    skipped: 'processing_error',
  });

  expect(listIngestionDurabilityReceipts(job.id)).toEqual([]);
  expect(listFacts({ originConversationId: threadId })).toEqual([]);
  expect(listEpisodes({ conversationId: threadId })).toEqual([]);
  expect(
    workingBlocks.getWorkingBlock('active_focus', {
      conversationId: threadId,
      threadId,
    }),
  ).toBeNull();
  expect(getConsolidationState(threadId)).toBeNull();
  expect(getIngestionJob(job.id)).toEqual(
    expect.objectContaining({
      status: 'retrying',
      structuralCompletedAt: null,
      outcomeCode: 'processing_error',
    }),
  );
});
