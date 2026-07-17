jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/database';
import {
  __resetIngestionQueueForTests,
  enqueueIngestionJob as enqueueStrictIngestionJob,
  getIngestionJob,
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

it('publishes terminal completion only after title focus is durable', async () => {
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
  const editFocus = workingBlocks.editPromptEligibleWorkingBlock;
  jest.spyOn(workingBlocks, 'editPromptEligibleWorkingBlock').mockImplementation((...args) => {
    statusAtFocusWrite.push(getIngestionJob(job.id)!.status);
    return editFocus(...args);
  });

  await expect(processIngestionJob({ jobId: job.id, now: 100 })).resolves.toEqual({
    processed: true,
    status: 'completed_structural',
  });
  expect(statusAtFocusWrite).toEqual(['processing']);
  expect(getIngestionJob(job.id)?.status).toBe('completed_structural');
  expect(
    workingBlocks.getWorkingBlock('active_focus', {
      conversationId: threadId,
      threadId,
    })?.content,
  ).toContain(threadTitle);
});
