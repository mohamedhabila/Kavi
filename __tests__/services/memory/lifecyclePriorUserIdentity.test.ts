jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/database';
import {
  __resetIngestionQueueForTests,
  cancelScheduledIngestionDrain,
  getIngestionJob,
} from '../../../src/services/memory/ingestionQueue';
import {
  __resetMemoryLifecycleForTests,
  recordCompletedTurnForMemory,
} from '../../../src/services/memory/lifecycle';
import { __resetOnDeviceGuardsForTests } from '../../../src/services/memory/onDeviceGuards';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { useChatStore } from '../../../src/store/useChatStore';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import type { Message } from '../../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  __resetMemoryLifecycleForTests();
  __resetOnDeviceGuardsForTests();
  __resetIngestionQueueForTests();
  useSettingsStore.setState({
    disableLongTermMemory: false,
    consolidationProvider: '',
    providers: [],
  } as any);
  useChatStore.setState({ conversations: [] } as any);
});

afterEach(async () => {
  await cancelScheduledIngestionDrain();
  closeMemoryDb();
});

it('seals the immediately prior user identity when the turn is enqueued', async () => {
  const history: Message[] = [
    { id: 'u-prior', role: 'user', content: 'My usual duration is 30 minutes.', timestamp: 1 },
    {
      id: 'a-prior',
      role: 'assistant',
      content: 'Understood.',
      timestamp: 2,
      assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
    },
    { id: 'u-current', role: 'user', content: 'Change it to 45 minutes.', timestamp: 3 },
    {
      id: 'a-current',
      role: 'assistant',
      content: 'Done.',
      timestamp: 4,
      assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
    },
  ];

  const result = await recordCompletedTurnForMemory({
    threadId: 'conv-sealed-prior',
    messages: history,
    sourceEndMessageId: 'a-current',
    now: 10,
  });

  expect(getIngestionJob(result.jobId!)?.priorUserMessageId).toBe('u-prior');
});
