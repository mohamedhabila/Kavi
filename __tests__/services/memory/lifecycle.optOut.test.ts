jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { getConsolidationState } from '../../../src/services/memory/consolidatorScheduler';
import { closeMemoryDb } from '../../../src/services/memory/database';
import { __resetIngestionQueueForTests } from '../../../src/services/memory/ingestionQueue';
import {
  __resetMemoryLifecycleForTests,
  recordCompletedTurnForMemory,
} from '../../../src/services/memory/lifecycle';
import { __resetOnDeviceGuardsForTests } from '../../../src/services/memory/onDeviceGuards';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { getWorkingBlock } from '../../../src/services/memory/workingBlocks';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { messages } from '../../helpers/memoryLifecycle';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  __resetMemoryLifecycleForTests();
  __resetOnDeviceGuardsForTests();
  __resetIngestionQueueForTests();
  useSettingsStore.setState({ disableLongTermMemory: false } as any);
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  useSettingsStore.setState({ disableLongTermMemory: false } as any);
});

describe('recordCompletedTurnForMemory opt-out', () => {
  it('creates no state or block writes when long-term memory is disabled', async () => {
    useSettingsStore.setState({ disableLongTermMemory: true } as any);

    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-disabled',
      messages,
      sourceEndMessageId: 'a-1',
      now: 10,
    });

    expect(result.processed).toBe(false);
    expect(result.skipped).toBe('opt_out');
    expect(getConsolidationState('conv-disabled')).toBeNull();
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-disabled',
        threadId: 'conv-disabled',
      }),
    ).toBeNull();
  });
});
