jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { makeTestAgentRun, makeTestConversation } from '../../helpers/factories';
import { closeMemoryDb } from '../../../src/services/memory/database';
import {
  __resetIngestionQueueForTests,
  cancelScheduledIngestionDrain,
  countPendingIngestionJobs,
} from '../../../src/services/memory/ingestionQueue';
import { getIngestionJobForSourceTurn } from '../../../src/services/memory/ingestionQueueStore';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { publishConversationTurnMemory } from '../../../src/services/memory/turnPublication';
import { useChatStore } from '../../../src/store/useChatStore';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import type { AgentRunControlGraphState } from '../../../src/types/agentRun';
import type { Message } from '../../../src/types/message';
import { insertRetiredMemorySourceForTest } from '../../helpers/memoryWithdrawalFixtures';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const messages: Message[] = [
  { id: 'user-old', role: 'user', content: 'Remember alpha.', timestamp: 1 },
  {
    id: 'assistant-old',
    role: 'assistant',
    content: 'I will remember alpha.',
    timestamp: 2,
    assistantMetadata: { kind: 'final', completionStatus: 'complete' },
  },
  { id: 'user-new', role: 'user', content: 'Remember beta.', timestamp: 3 },
  {
    id: 'assistant-new',
    role: 'assistant',
    content: 'I will remember beta.',
    timestamp: 4,
    assistantMetadata: { kind: 'final', completionStatus: 'complete' },
  },
];

function setConversation(overrides: Parameters<typeof makeTestConversation>[0] = {}): void {
  const conversation = makeTestConversation({
    id: 'conversation-publication',
    title: 'Exact publication',
    messages,
    ...overrides,
  });
  useChatStore.setState({
    conversations: [conversation],
    activeConversationId: conversation.id,
  });
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  __resetIngestionQueueForTests();
  useSettingsStore.setState({
    disableLongTermMemory: false,
    consolidationProvider: '',
    providers: [],
  } as any);
  setConversation();
});

afterEach(async () => {
  await cancelScheduledIngestionDrain();
  closeMemoryDb();
});

describe('publishConversationTurnMemory', () => {
  it('publishes only the exact requested final and seals its exact source-run task', async () => {
    const controlGraph = {
      goals: [
        {
          id: 'goal-exact',
          title: 'Remember alpha exactly',
          status: 'active',
          dependencies: [],
          evidence: [],
          completionPolicy: 'blocking',
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      activeTaskId: 'goal-exact',
    } as AgentRunControlGraphState;
    setConversation({
      agentRuns: [
        makeTestAgentRun({
          id: 'run-exact',
          userMessageId: 'user-old',
          controlGraph,
        }),
      ],
    });

    const result = await publishConversationTurnMemory('conversation-publication', undefined, {
      sourceEndMessageId: 'assistant-old',
      sourceRunId: 'run-exact',
    });

    expect(result).toEqual({ disposition: 'enqueued', jobId: expect.any(String) });
    expect(
      getIngestionJobForSourceTurn({
        memoryConversationId: 'conversation-publication',
        sourceThreadId: 'conversation-publication',
        sourceEndMessageId: 'assistant-old',
      }),
    ).toMatchObject({
      id: result.jobId,
      sourceEndMessageId: 'assistant-old',
      sourceRunId: 'run-exact',
      taskId: 'goal-exact',
    });
    expect(
      getIngestionJobForSourceTurn({
        memoryConversationId: 'conversation-publication',
        sourceThreadId: 'conversation-publication',
        sourceEndMessageId: 'assistant-new',
      }),
    ).toBeNull();
  });

  it('rejects a missing exact final instead of falling back to the latest final', async () => {
    await expect(
      publishConversationTurnMemory('conversation-publication', undefined, {
        sourceEndMessageId: 'assistant-missing',
      }),
    ).rejects.toThrow('memory_turn_publication_source_identity_invalid');
    expect(countPendingIngestionJobs()).toBe(0);
  });

  it('rejects an earlier final followed by a later assistant projection', async () => {
    setConversation({
      messages: [
        { id: 'user-projected', role: 'user', content: 'Remember gamma.', timestamp: 1 },
        {
          id: 'assistant-claimed',
          role: 'assistant',
          content: 'Gamma is captured.',
          timestamp: 2,
          assistantMetadata: { kind: 'final', completionStatus: 'complete' },
        },
        {
          id: 'assistant-later',
          role: 'assistant',
          content: 'Waiting for background work.',
          timestamp: 3,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'yielded',
          },
        },
      ],
    });

    await expect(
      publishConversationTurnMemory('conversation-publication', undefined, {
        sourceEndMessageId: 'assistant-claimed',
      }),
    ).rejects.toThrow('memory_turn_publication_source_identity_invalid');
    expect(countPendingIngestionJobs()).toBe(0);
  });

  it('rejects an exact assistant projection that has not closed', async () => {
    setConversation({
      messages: [
        { id: 'user-open', role: 'user', content: 'Remember gamma.', timestamp: 1 },
        {
          id: 'assistant-open',
          role: 'assistant',
          content: '',
          timestamp: 2,
          assistantMetadata: { kind: 'final', completionStatus: 'incomplete' },
        },
      ],
    });

    await expect(
      publishConversationTurnMemory('conversation-publication', undefined, {
        sourceEndMessageId: 'assistant-open',
      }),
    ).rejects.toThrow('memory_turn_publication_no_closed_turn');
    expect(countPendingIngestionJobs()).toBe(0);
  });

  it('rejects missing conversation and exact source-run ownership', async () => {
    await expect(
      publishConversationTurnMemory('conversation-missing', undefined, {
        sourceEndMessageId: 'assistant-old',
      }),
    ).rejects.toThrow('memory_turn_publication_conversation_unavailable');

    await expect(
      publishConversationTurnMemory('conversation-publication', undefined, {
        sourceEndMessageId: 'assistant-old',
        sourceRunId: 'run-missing',
      }),
    ).rejects.toThrow('memory_turn_publication_source_run_unavailable');
    expect(countPendingIngestionJobs()).toBe(0);
  });

  it('returns the same durable job for an exact duplicate publication', async () => {
    const first = await publishConversationTurnMemory('conversation-publication', undefined, {
      sourceEndMessageId: 'assistant-new',
    });
    const duplicate = await publishConversationTurnMemory('conversation-publication', undefined, {
      sourceEndMessageId: 'assistant-new',
    });

    expect(first).toEqual({ disposition: 'enqueued', jobId: expect.any(String) });
    expect(duplicate).toEqual({ disposition: 'enqueued', jobId: first.jobId });
    expect(
      getIngestionJobForSourceTurn({
        memoryConversationId: 'conversation-publication',
        sourceThreadId: 'conversation-publication',
        sourceEndMessageId: 'assistant-new',
      }),
    ).toMatchObject({ id: first.jobId, sourceEndMessageId: 'assistant-new' });
  });

  it('accepts explicit privacy opt-out and side-thread exclusion without a job', async () => {
    useSettingsStore.setState({ disableLongTermMemory: true } as any);
    await expect(
      publishConversationTurnMemory('conversation-publication', undefined, {
        sourceEndMessageId: 'assistant-new',
      }),
    ).resolves.toEqual({ disposition: 'opt_out', jobId: null });

    useSettingsStore.setState({ disableLongTermMemory: false } as any);
    setConversation({ isSideThread: true });
    await expect(
      publishConversationTurnMemory('conversation-publication', undefined, {
        sourceEndMessageId: 'assistant-new',
      }),
    ).resolves.toEqual({ disposition: 'ephemeral_thread', jobId: null });
    expect(countPendingIngestionJobs()).toBe(0);
  });

  it('settles a withdrawn exact source without mutating working memory or queue state', async () => {
    insertRetiredMemorySourceForTest({
      retirementGroupId: 'withdrawal-publication',
      memoryConversationId: 'conversation-publication',
      sourceThreadId: 'conversation-publication',
      sourceKind: 'turn',
      sourceId: 'assistant-new',
    });

    await expect(
      publishConversationTurnMemory('conversation-publication', undefined, {
        sourceEndMessageId: 'assistant-new',
      }),
    ).resolves.toEqual({ disposition: 'withdrawn', jobId: null });
    expect(countPendingIngestionJobs()).toBe(0);
  });
});
