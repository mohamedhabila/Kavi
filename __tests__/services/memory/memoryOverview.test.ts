jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import { editWorkingBlock } from '../../../src/services/memory/workingBlocks';
import { upsertMemoryTask } from '../../../src/services/memory/tasks';
import { enqueueIngestionJob } from '../../../src/services/memory/ingestionQueue';
import { loadMemoryOverviewSnapshot } from '../../../src/services/memory/memoryOverview';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

describe('loadMemoryOverviewSnapshot', () => {
  it('returns focus, active task, and pending ingestion jobs', () => {
    editWorkingBlock('active_focus', 'Trip planning focus', {
      conversationId: 'conv-1',
      threadId: 'conv-1',
    });
    upsertMemoryTask({
      id: 'task-1',
      threadId: 'conv-1',
      title: 'Plan trip',
      state: 'active',
    });
    enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-1',
      threadTitle: null,
      memoryConversationId: 'conv-1',
      taskId: null,
      sourceStartMessageId: null,
      sourceEndMessageId: 'assistant-1',
      sourceRunId: null,
      sourceAt: 1,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
    });

    const snapshot = loadMemoryOverviewSnapshot();
    expect(snapshot.focus?.content).toContain('Trip planning focus');
    expect(snapshot.activeTask?.title).toBe('Plan trip');
    expect(snapshot.pendingIngestionJobs).toBe(1);
    expect(snapshot.consolidation.tier).toBeTruthy();
  });
});
