jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/database';
import { editWorkingBlock } from '../../../src/services/memory/workingBlocks';
import { enqueueIngestionJob as enqueueStrictIngestionJob } from '../../../src/services/memory/ingestionQueue';
import { loadMemoryOverviewSnapshot } from '../../../src/services/memory/memoryOverview';
import { createTestIngestionJobEnqueuer } from '../../helpers/ingestionSourceSnapshotFixture';

const enqueueIngestionJob = createTestIngestionJobEnqueuer(enqueueStrictIngestionJob);

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
  it('returns focus and pending ingestion jobs', () => {
    editWorkingBlock('active_focus', 'Trip planning focus', {
      conversationId: 'conv-1',
      threadId: 'conv-1',
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
    expect(snapshot).not.toHaveProperty('activeTask');
    expect(snapshot.pendingIngestionJobs).toBe(1);
    expect(snapshot.consolidation.tier).toBeTruthy();
  });
});
