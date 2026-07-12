import type { CronJob } from '../../src/services/cron/types';
import type { ModelProjectionOwner } from '../../src/types/conversation';

const mockFlushChatStorePersistenceNow = jest.fn().mockResolvedValue(undefined);

jest.mock('../../src/store/chatStorePersistence', () => ({
  flushChatStorePersistenceNow: (...args: unknown[]) => mockFlushChatStorePersistenceNow(...args),
  requestChatStorePersistenceCheckpoint: jest.fn(),
}));

import { claimModelProjection } from '../../src/store/modelProjectionOwnership';
import {
  beginModelProjectionIntent,
  resetModelProjectionIntentCoordinatorForTests,
} from '../../src/store/modelProjectionIntentCoordinator';
import { useChatStore } from '../../src/store/useChatStore';
import { SchedulerProjectionBusyError } from '../../src/services/scheduler/executionError';
import {
  claimScheduledProjection,
  releaseScheduledProjection,
  resetScheduledProjectionReleaseRecoveryForTests,
  scheduledProjectionOwner,
} from '../../src/services/scheduler/jobExecutorProjection';

function scheduledJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: 'job-1',
    definitionRevision: 1,
    name: 'Projection test',
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    schedule: { kind: 'every', everyMs: 60_000 },
    sessionTarget: 'main',
    wakeMode: 'continue',
    payload: { prompt: 'Run the scheduled task.', mode: 'agentic' },
    runningAttemptId: 'attempt-1',
    runningOccurrenceId: 'occurrence-1',
    runningStartedAtMs: 1,
    runningDefinitionRevision: 1,
    runningAttemptNumber: 1,
    runningEffectRisk: 'safe',
    ...overrides,
  };
}

function createConversation(): string {
  return useChatStore.getState().createConversation('provider-1', 'Be helpful.');
}

function snapshotConversation(conversationId: string): string {
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversationId);
  return JSON.stringify(conversation);
}

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  resetModelProjectionIntentCoordinatorForTests();
  resetScheduledProjectionReleaseRecoveryForTests();
  useChatStore.setState({ conversations: [], activeConversationId: null, isLoading: false });
  mockFlushChatStorePersistenceNow.mockResolvedValue(undefined);
});

afterEach(() => {
  resetScheduledProjectionReleaseRecoveryForTests();
  jest.useRealTimers();
});

describe('scheduled model projection ownership', () => {
  it('uses one stable occurrence owner and idempotent prelude across a retry', () => {
    const conversationId = createConversation();
    const firstJob = scheduledJob();
    const retryJob = scheduledJob({
      runningAttemptId: 'attempt-2',
      runningAttemptNumber: 2,
      runningOccurrenceId: firstJob.runningOccurrenceId,
    });

    const firstLease = claimScheduledProjection({
      job: firstJob,
      conversationId,
      prompt: firstJob.payload.prompt,
    });
    const retryLease = claimScheduledProjection({
      job: retryJob,
      conversationId,
      prompt: retryJob.payload.prompt,
    });

    expect(firstLease).toEqual(retryLease);
    expect(firstLease.owner).toEqual({
      surface: 'scheduler',
      runId: 'occurrence-1',
      requestMessageId: 'scheduled:occurrence-1:user',
      assistantMessageId: 'scheduled:occurrence-1:assistant',
      controlEpoch: 0,
    });
    expect(
      useChatStore.getState().conversations.find((item) => item.id === conversationId)?.messages,
    ).toMatchObject([
      { id: firstLease.owner.requestMessageId, role: 'user', content: firstJob.payload.prompt },
      { id: firstLease.owner.assistantMessageId, role: 'assistant', content: '' },
    ]);
  });

  it('rejects a second scheduled occurrence without mutating the claimed conversation', () => {
    const conversationId = createConversation();
    claimScheduledProjection({
      job: scheduledJob(),
      conversationId,
      prompt: 'First occurrence.',
    });
    const before = snapshotConversation(conversationId);

    expect(() =>
      claimScheduledProjection({
        job: scheduledJob({
          id: 'job-2',
          runningAttemptId: 'attempt-2',
          runningOccurrenceId: 'occurrence-2',
        }),
        conversationId,
        prompt: 'Second occurrence.',
      }),
    ).toThrow(expect.objectContaining({ name: 'SchedulerProjectionBusyError' }));
    expect(snapshotConversation(conversationId)).toBe(before);
  });

  it('defers to foreground intent without changing messages, mode, persona, or model', () => {
    const conversationId = createConversation();
    useChatStore.getState().updateModeInConversation(conversationId, 'chitchat');
    useChatStore.getState().updatePersonaInConversation(conversationId, 'default');
    useChatStore.getState().updateModelInConversation(conversationId, 'provider-1', 'model-1');
    const before = snapshotConversation(conversationId);
    const intent = beginModelProjectionIntent(conversationId, 'foreground-request');

    expect(() =>
      claimScheduledProjection({
        job: scheduledJob(),
        conversationId,
        prompt: 'Scheduled request.',
      }),
    ).toThrow(
      expect.objectContaining<Partial<SchedulerProjectionBusyError>>({
        reason: 'model_projection_intent',
      }),
    );
    expect(snapshotConversation(conversationId)).toBe(before);
    intent.release();
  });

  it('defers on an unsettled foreign tail without any projection mutation', () => {
    const conversationId = createConversation();
    useChatStore.getState().addMessage(conversationId, {
      id: 'foreground-user',
      role: 'user',
      content: 'Foreground work',
      timestamp: 2,
    });
    useChatStore.getState().addMessage(conversationId, {
      id: 'foreground-assistant',
      role: 'assistant',
      content: 'Still working',
      timestamp: 3,
    });
    const before = snapshotConversation(conversationId);

    expect(() =>
      claimScheduledProjection({
        job: scheduledJob(),
        conversationId,
        prompt: 'Scheduled request.',
      }),
    ).toThrow(
      expect.objectContaining<Partial<SchedulerProjectionBusyError>>({
        reason: 'unsettled_conversation_tail',
      }),
    );
    expect(snapshotConversation(conversationId)).toBe(before);
  });

  it('retries only the failed release flush and never releases a newer owner', async () => {
    jest.useFakeTimers();
    const conversationId = createConversation();
    const lease = claimScheduledProjection({
      job: scheduledJob(),
      conversationId,
      prompt: 'Scheduled request.',
    });
    mockFlushChatStorePersistenceNow
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockResolvedValue(undefined);

    await expect(releaseScheduledProjection(lease)).rejects.toThrow('disk unavailable');
    const foregroundOwner: ModelProjectionOwner = {
      surface: 'foreground',
      runId: 'foreground-run',
      requestMessageId: 'foreground-request',
      assistantMessageId: 'foreground-assistant',
      controlEpoch: 0,
    };
    expect(
      claimModelProjection({
        conversationId,
        owner: foregroundOwner,
        messagesBeforeAssistant: [
          {
            id: foregroundOwner.requestMessageId,
            role: 'user',
            content: 'Foreground request.',
            timestamp: 10,
          },
        ],
        assistantMessage: {
          id: foregroundOwner.assistantMessageId,
          role: 'assistant',
          content: '',
          timestamp: 11,
        },
      }),
    ).toBe('claimed');

    await jest.advanceTimersByTimeAsync(1_000);

    expect(mockFlushChatStorePersistenceNow).toHaveBeenCalledTimes(2);
    expect(
      useChatStore.getState().conversations.find((item) => item.id === conversationId)
        ?.modelProjectionOwner,
    ).toEqual(foregroundOwner);
  });

  it('derives an attempt owner when the persisted occurrence is absent', () => {
    expect(
      scheduledProjectionOwner(scheduledJob({ runningOccurrenceId: undefined })),
    ).toMatchObject({
      runId: 'attempt-1',
      requestMessageId: 'scheduled:attempt-1:user',
      assistantMessageId: 'scheduled:attempt-1:assistant',
    });
  });

  it('rejects execution without durable attempt identity before claiming a transcript', () => {
    const conversationId = createConversation();

    expect(() =>
      claimScheduledProjection({
        job: scheduledJob({ runningOccurrenceId: undefined, runningAttemptId: undefined }),
        conversationId,
        prompt: 'Must not run.',
      }),
    ).toThrow(
      expect.objectContaining({
        name: 'NonRetryableSchedulerExecutionError',
        message: 'Scheduled execution is missing its durable occurrence identity.',
      }),
    );
    expect(
      useChatStore.getState().conversations.find((item) => item.id === conversationId)?.messages,
    ).toEqual([]);
  });
});
