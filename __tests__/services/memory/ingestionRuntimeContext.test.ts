jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { enqueueIngestionJob } from '../../../src/services/memory/ingestionQueue';
import { createInitialAgentControlGraphSnapshot } from '../../../src/engine/graph/agentControlGraph';
import { loadIngestionJobRuntimeContext } from '../../../src/services/memory/lifecycle';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/database';
import { useChatStore } from '../../../src/store/useChatStore';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function completedRun(id: string, updatedAt: number, evidence: string) {
  return {
    id,
    userMessageId: `user-${id}`,
    goal: `Complete ${id}`,
    status: 'completed' as const,
    createdAt: updatedAt - 1,
    updatedAt,
    completedAt: updatedAt,
    currentPhase: 'deliver' as const,
    phases: [],
    checkpoints: [],
    summary: {
      assistantTurns: 1,
      startedTools: 1,
      completedTools: 1,
      failedTools: 0,
      spawnedSubAgents: 0,
    },
    controlGraph: createInitialAgentControlGraphSnapshot({
      goals: [
        {
          id: `goal-${id}`,
          title: `Goal ${id}`,
          status: 'completed',
          dependencies: [],
          evidence: [evidence],
          createdAt: updatedAt - 1,
          updatedAt,
          completedAt: updatedAt,
        },
      ],
      updatedAt,
    }),
  };
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({
    disableLongTermMemory: false,
    providers: [
      {
        id: 'provider-context',
        name: 'Context provider',
        baseUrl: 'https://context.invalid/v1',
        model: 'current-default-model',
        enabled: true,
      },
    ],
  } as never);
  useChatStore.setState({
    conversations: [
      {
        id: 'thread-context',
        title: 'Exact thread title',
        providerId: 'provider-context',
        modelOverride: 'current-conversation-model',
        systemPrompt: '',
        createdAt: 1,
        updatedAt: 20,
        messages: [],
        agentRuns: [
          completedRun('run-old', 10, 'tool:old-evidence'),
          completedRun('run-new', 20, 'tool:new-evidence'),
        ],
      },
    ],
  } as never);
});

afterEach(() => {
  closeMemoryDb();
});

describe('ingestion runtime context', () => {
  it('resolves the persisted provider model and exact source run, not the latest run', () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'thread-context',
      threadTitle: 'Persisted thread title',
      memoryConversationId: 'thread-context',
      taskId: null,
      sourceStartMessageId: null,
      sourceEndMessageId: 'assistant-old',
      sourceRunId: 'run-old',
      sourceAt: 5,
      chatProviderId: 'provider-context',
      chatModel: 'persisted-job-model',
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 5,
    })!;

    expect(loadIngestionJobRuntimeContext(job)).toEqual({
      activeChatProvider: expect.objectContaining({
        id: 'provider-context',
        model: 'persisted-job-model',
      }),
      graphGoalEvidence: ['tool:old-evidence'],
    });
  });

  it('does not attach mutable latest-run evidence when the job has no source run', () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'thread-context',
      threadTitle: 'Persisted chitchat title',
      memoryConversationId: 'thread-context',
      taskId: null,
      sourceStartMessageId: null,
      sourceEndMessageId: 'assistant-chitchat',
      sourceRunId: null,
      sourceAt: 6,
      chatProviderId: 'provider-context',
      chatModel: 'persisted-job-model',
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 6,
    })!;

    expect(loadIngestionJobRuntimeContext(job)).toEqual({
      activeChatProvider: expect.objectContaining({
        id: 'provider-context',
        model: 'persisted-job-model',
      }),
    });
  });

  it('retains source-run provenance when the original run is no longer available', () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'thread-context',
      threadTitle: 'Historical title',
      memoryConversationId: 'thread-context',
      taskId: null,
      sourceStartMessageId: null,
      sourceEndMessageId: 'assistant-removed-run',
      sourceRunId: 'run-removed',
      sourceAt: 7,
      chatProviderId: 'provider-context',
      chatModel: 'persisted-job-model',
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 7,
    })!;

    expect(job.sourceRunId).toBe('run-removed');
    expect(loadIngestionJobRuntimeContext(job)).toEqual({
      activeChatProvider: expect.objectContaining({
        id: 'provider-context',
        model: 'persisted-job-model',
      }),
    });
  });
});
