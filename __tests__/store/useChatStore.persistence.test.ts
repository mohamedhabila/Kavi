import { STORAGE_KEYS } from '../../src/constants/storage';
import {
  _getStorageFileUris,
  _resetThrottledStorageStateForTests,
  flushPendingStorageWrites,
  throttledAsyncStorage,
} from '../../src/store/throttledStorage';
import { CHAT_STORE_CHECKPOINT_DELAY_MS } from '../../src/store/chatStorePersistence';
import { useChatStore } from '../../src/store/useChatStore';

const expoFileSystemMock = jest.requireMock('expo-file-system') as {
  __resetStore: () => void;
  __getStore: () => Record<string, string | Uint8Array>;
};

function readPersistedChatState(): any {
  const { primary } = _getStorageFileUris(STORAGE_KEYS.CONVERSATIONS);
  const raw = expoFileSystemMock.__getStore()[primary];
  return typeof raw === 'string' ? JSON.parse(raw) : undefined;
}

async function advanceAndSettle(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  await jest.advanceTimersByTimeAsync(0);
}

async function advanceBeforeCheckpoint(): Promise<void> {
  await advanceAndSettle(CHAT_STORE_CHECKPOINT_DELAY_MS - 50);
}

async function advancePastCheckpoint(): Promise<void> {
  await advanceAndSettle(CHAT_STORE_CHECKPOINT_DELAY_MS + 50);
}

beforeEach(async () => {
  await flushPendingStorageWrites();
  _resetThrottledStorageStateForTests();
  jest.useFakeTimers();
  expoFileSystemMock.__resetStore();
  await throttledAsyncStorage.removeItem(STORAGE_KEYS.CONVERSATIONS);
  useChatStore.setState({
    conversations: [],
    activeConversationId: null,
    isLoading: false,
  });
  await flushPendingStorageWrites(STORAGE_KEYS.CONVERSATIONS);
});

afterEach(async () => {
  await flushPendingStorageWrites();
  _resetThrottledStorageStateForTests();
  jest.useRealTimers();
});

describe('useChatStore persistence checkpoints', () => {
  it('persists a new conversation before the normal throttle window', async () => {
    const id = useChatStore.getState().createConversation('provider1', 'System prompt');

    await advanceBeforeCheckpoint();
    expect(readPersistedChatState()?.state?.conversations ?? []).toHaveLength(0);

    await advanceAndSettle(100);
    const persisted = readPersistedChatState();

    expect(persisted.state.activeConversationId).toBe(id);
    expect(persisted.state.conversations[0]).toEqual(
      expect.objectContaining({
        id,
        providerId: 'provider1',
        systemPrompt: 'System prompt',
      }),
    );
  });

  it('persists the latest user message on the fast checkpoint schedule', async () => {
    const id = useChatStore.getState().createConversation('provider1', 'System prompt');
    await advancePastCheckpoint();

    useChatStore.getState().addMessage(id, {
      role: 'user',
      content: 'Hello world',
    });

    await advanceBeforeCheckpoint();
    let persisted = readPersistedChatState();
    expect(persisted.state.conversations[0].messages).toHaveLength(0);

    await advanceAndSettle(100);
    persisted = readPersistedChatState();
    expect(persisted.state.conversations[0].messages[0]).toEqual(
      expect.objectContaining({
        role: 'user',
        content: 'Hello world',
      }),
    );
    expect(persisted.state.conversations[0].title).toBe('Hello world');
  });

  it('persists agent run plan updates on the checkpoint schedule', async () => {
    const id = useChatStore.getState().createConversation('provider1', 'System prompt');
    await advancePastCheckpoint();

    useChatStore.getState().addMessage(id, {
      id: 'msg-user-plan',
      role: 'user',
      content: 'Plan the work',
    });
    const runId = useChatStore.getState().startAgentRun(id, {
      userMessageId: 'msg-user-plan',
      goal: 'Plan the work',
      timestamp: 1_700_000_000_000,
    });
    await advancePastCheckpoint();

    useChatStore.getState().updateAgentRunPlan(
      id,
      {
        objective: 'Ship a production-ready workflow plan',
        successCriteria: ['Persist plan state', 'Keep checkpoints durable'],
        stopConditions: ['Stop after the plan is durable'],
        workstreams: [{ id: 'ws-1', title: 'Durability' }],
        updatedAt: 1_700_000_000_100,
      },
      runId,
    );

    await advanceBeforeCheckpoint();
    let persisted = readPersistedChatState();
    expect(persisted.state.conversations[0].agentRuns[0].plan.objective).not.toBe(
      'Ship a production-ready workflow plan',
    );

    await advanceAndSettle(100);
    persisted = readPersistedChatState();
    expect(persisted.state.conversations[0].agentRuns[0].plan).toEqual(
      expect.objectContaining({
        objective: 'Ship a production-ready workflow plan',
        successCriteria: ['Persist plan state', 'Keep checkpoints durable'],
        stopConditions: ['Stop after the plan is durable'],
        workstreams: [{ id: 'ws-1', title: 'Durability' }],
        updatedAt: 1_700_000_000_100,
      }),
    );
  });

  it('persists bounded workflow evidence on the checkpoint schedule', async () => {
    const id = useChatStore.getState().createConversation('provider1', 'System prompt');
    await advancePastCheckpoint();

    useChatStore.getState().addMessage(id, {
      id: 'msg-user-evidence',
      role: 'user',
      content: 'Track workflow evidence',
    });
    const runId = useChatStore.getState().startAgentRun(id, {
      userMessageId: 'msg-user-evidence',
      goal: 'Track workflow evidence',
      timestamp: 1_700_000_100_000,
    });
    await advancePastCheckpoint();

    for (let index = 0; index < 70; index += 1) {
      useChatStore.getState().recordAgentRunEvidence(
        id,
        {
          kind: 'fact',
          title: `Entry ${index}`,
          content: `Evidence detail ${index}`,
        },
        {
          timestamp: 1_700_000_100_100 + index,
        },
        runId,
      );
    }

    await advancePastCheckpoint();

    const persisted = readPersistedChatState();
    const evidence = persisted.state.conversations[0].agentRuns[0].evidence;

    expect(evidence).toHaveLength(64);
    expect(evidence[0]).toEqual(expect.objectContaining({ title: 'Entry 6' }));
    expect(evidence[evidence.length - 1]).toEqual(expect.objectContaining({ title: 'Entry 69' }));
  });
});
