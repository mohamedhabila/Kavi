jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../../src/services/memory/database';
import { resetMemoryCoreSchemaCacheForTests } from '../../../../src/services/memory/core/memorySchema';
import { publishConversationTurnMemory } from '../../../../src/services/memory/core/memoryCapture';
import { searchMemoryItems } from '../../../../src/services/memory/core/memoryItemsStore';
import {
  __resetMemoryExtractionWorkerForTests,
  EXTRACTION_IDLE_POLL_MS,
} from '../../../../src/services/memory/core/memoryExtractionWorker';
import {
  __resetOnDeviceGuardsForTests,
  acquireMainInferenceLease,
} from '../../../../src/services/memory/onDeviceGuards';
import { useChatStore } from '../../../../src/store/useChatStore';
import { useSettingsStore } from '../../../../src/store/useSettingsStore';
import type { Conversation } from '../../../../src/types/conversation';
import type { Message } from '../../../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const turn: Message[] = [
  { id: 'u1', role: 'user', content: 'My sister Sara moved to Porto.', timestamp: 10 },
  {
    id: 'a1',
    role: 'assistant',
    content: 'Porto is a lovely city.',
    timestamp: 11,
    assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
  },
];
const ADD_SARA = JSON.stringify({
  operations: [{ op: 'add', id: null, text: 'Sara (the user’s sister) lives in Porto' }],
});

function setThreadMessages(messages: Message[]): void {
  const conversation = {
    id: 'conv-1',
    title: 'Kavi',
    messages,
    providerId: 'provider-1',
    systemPrompt: '',
    createdAt: 1,
    updatedAt: 1,
  } as Conversation;
  useChatStore.setState({ conversations: [conversation], activeConversationId: 'conv-1' });
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetMemoryCoreSchemaCacheForTests();
  __resetOnDeviceGuardsForTests();
  useSettingsStore.setState({ disableLongTermMemory: false });
});

afterEach(() => {
  __resetMemoryExtractionWorkerForTests();
  jest.useRealTimers();
});

afterAll(() => {
  closeMemoryDb();
});

it('extracts a turn that left the thread’s live messages before extraction ran', async () => {
  const call = jest.fn(async () => ADD_SARA);
  __resetMemoryExtractionWorkerForTests({ resolveModel: async () => call, now: () => 1_000 });
  setThreadMessages(turn);
  // A foreground turn holds the model, so extraction waits after the turn is captured.
  const lease = acquireMainInferenceLease('turn-2');

  publishConversationTurnMemory('conv-1', 'a1');
  await settle();
  // The round leaves the live messages (the message cap, or the user resetting the context).
  setThreadMessages([]);
  lease.release();
  jest.advanceTimersByTime(EXTRACTION_IDLE_POLL_MS);
  await settle();

  expect(call).toHaveBeenCalledTimes(1);
  expect(
    searchMemoryItems({ query: 'Sara Porto', limit: 5, includeSensitive: true }).map(
      (item) => item.text,
    ),
  ).toEqual(['Sara (the user’s sister) lives in Porto']);
});
