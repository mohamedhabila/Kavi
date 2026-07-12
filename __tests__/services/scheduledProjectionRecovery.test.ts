import type { CronJob } from '../../src/services/cron/types';

const mockFlushChatStorePersistenceNow = jest.fn().mockResolvedValue(undefined);

jest.mock('../../src/store/chatStorePersistence', () => ({
  flushChatStorePersistenceNow: (...args: unknown[]) => mockFlushChatStorePersistenceNow(...args),
  requestChatStorePersistenceCheckpoint: jest.fn(),
}));

import { useChatStore } from '../../src/store/useChatStore';
import {
  abortAllScheduledJobExecutions,
  getScheduledExecutionLifecycleEpoch,
  registerScheduledJobExecution,
  resetScheduledExecutionLifecycleForTests,
} from '../../src/services/scheduler/executionLifecycle';
import {
  claimScheduledProjection,
  resetScheduledProjectionReleaseRecoveryForTests,
} from '../../src/services/scheduler/jobExecutorProjection';
import { releaseStaleScheduledProjectionOwners } from '../../src/services/scheduler/scheduledProjectionRecovery';
import { useSchedulerStore } from '../../src/services/scheduler/store';

function runningJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: 'job-1',
    definitionRevision: 1,
    name: 'Recover projection',
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    schedule: { kind: 'every', everyMs: 60_000 },
    sessionTarget: 'main',
    wakeMode: 'continue',
    payload: { prompt: 'Recover this task.', mode: 'agentic' },
    runningAttemptId: 'attempt-1',
    runningOccurrenceId: 'occurrence-1',
    runningStartedAtMs: 1,
    runningDefinitionRevision: 1,
    runningAttemptNumber: 1,
    runningEffectRisk: 'safe',
    ...overrides,
  };
}

function seedStaleProjection(job: CronJob): string {
  const conversationId = useChatStore.getState().createConversation('provider-1', 'Be helpful.');
  claimScheduledProjection({
    job,
    conversationId,
    prompt: job.payload.prompt,
  });
  useSchedulerStore.setState({ jobs: [job], terminalReports: [] });
  return conversationId;
}

function recoveredConversation(conversationId: string) {
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversationId);
  if (!conversation) throw new Error('missing recovered conversation');
  return conversation;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetScheduledProjectionReleaseRecoveryForTests();
  resetScheduledExecutionLifecycleForTests();
  useChatStore.setState({ conversations: [], activeConversationId: null, isLoading: false });
  useSchedulerStore.setState({ jobs: [], terminalReports: [] });
  mockFlushChatStorePersistenceNow.mockResolvedValue(undefined);
});

afterEach(() => {
  expect(abortAllScheduledJobExecutions()).toBe(0);
  resetScheduledExecutionLifecycleForTests();
  resetScheduledProjectionReleaseRecoveryForTests();
});

describe('stale scheduled projection recovery', () => {
  it('preserves safe retry classification before stranded-attempt reconciliation clears it', async () => {
    const job = runningJob();
    const conversationId = seedStaleProjection(job);

    await expect(releaseStaleScheduledProjectionOwners()).resolves.toBe(1);

    const conversation = recoveredConversation(conversationId);
    expect(conversation.modelProjectionOwner).toBeUndefined();
    expect(conversation.messages).toMatchObject([
      { id: 'scheduled:occurrence-1:user', role: 'user' },
      { id: 'scheduled:occurrence-1:assistant', role: 'assistant', content: '' },
    ]);
    const [reconciled] = useSchedulerStore.getState().reconcileStrandedAttempts(100);
    expect(reconciled).toMatchObject({
      runningAttemptId: undefined,
      retryOccurrenceId: 'occurrence-1',
      nextRetryAtMs: 100,
    });
  });

  it('settles an unsafe stale transcript before releasing its owner', async () => {
    const job = runningJob({ runningEffectRisk: 'unsafe' });
    const conversationId = seedStaleProjection(job);

    await releaseStaleScheduledProjectionOwners();

    const conversation = recoveredConversation(conversationId);
    expect(conversation.modelProjectionOwner).toBeUndefined();
    expect(conversation.messages.at(-1)).toMatchObject({
      role: 'assistant',
      isError: true,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'incomplete',
        finishReason: 'app_restarted',
      },
    });
    expect(conversation.messages.at(-1)?.content).toContain('replay was suppressed');
    expect(mockFlushChatStorePersistenceNow).toHaveBeenCalledTimes(2);
  });

  it('does not duplicate an unsafe transcript that already has a settled failure', async () => {
    const job = runningJob({ runningEffectRisk: 'unsafe' });
    const conversationId = seedStaleProjection(job);
    useChatStore
      .getState()
      .updateMessage(conversationId, 'scheduled:occurrence-1:assistant', 'Failed.');
    useChatStore
      .getState()
      .updateMessageAssistantMetadata(conversationId, 'scheduled:occurrence-1:assistant', {
        kind: 'final',
        completionStatus: 'incomplete',
        finishReason: 'response_failed',
      });

    await releaseStaleScheduledProjectionOwners();

    const conversation = recoveredConversation(conversationId);
    expect(conversation.modelProjectionOwner).toBeUndefined();
    expect(conversation.messages).toHaveLength(2);
    expect(conversation.messages.at(-1)).toMatchObject({
      content: 'Failed.',
      assistantMetadata: { finishReason: 'response_failed' },
    });
  });

  it('projects durable completion before stranded-attempt reconciliation clears it', async () => {
    const job = runningJob({
      runningCompletion: {
        completedAtMs: 50,
        output: 'Recovered durable result.',
        conversationId: 'conversation-1',
        conversationDurable: true,
      },
    });
    const conversationId = seedStaleProjection(job);

    await releaseStaleScheduledProjectionOwners();

    const conversation = recoveredConversation(conversationId);
    expect(conversation.modelProjectionOwner).toBeUndefined();
    expect(conversation.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Recovered durable result.',
      timestamp: 50,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'scheduler_completion_recovered',
      },
    });
    const [reconciled] = useSchedulerStore.getState().reconcileStrandedAttempts(100);
    expect(reconciled).toMatchObject({
      runningAttemptId: undefined,
      runningCompletion: undefined,
      lastSuccessAtMs: 50,
    });
    expect(useSchedulerStore.getState().terminalReports.at(-1)).toMatchObject({
      status: 'success',
      output: 'Recovered durable result.',
    });
  });

  it('projects durable completion when a stale final contains different output', async () => {
    const job = runningJob({
      runningCompletion: {
        completedAtMs: 50,
        output: 'Authoritative durable result.',
        conversationDurable: true,
      },
    });
    const conversationId = seedStaleProjection(job);
    useChatStore
      .getState()
      .updateMessage(conversationId, 'scheduled:occurrence-1:assistant', 'Stale final text.');
    useChatStore
      .getState()
      .updateMessageAssistantMetadata(conversationId, 'scheduled:occurrence-1:assistant', {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      });

    await releaseStaleScheduledProjectionOwners();

    expect(recoveredConversation(conversationId).messages.at(-1)).toMatchObject({
      content: 'Authoritative durable result.',
      assistantMetadata: { finishReason: 'scheduler_completion_recovered' },
    });
  });

  it('never releases an owner until an active execution fully unregisters', async () => {
    const job = runningJob();
    const conversationId = seedStaleProjection(job);
    const registration = registerScheduledJobExecution(
      job.id,
      getScheduledExecutionLifecycleEpoch(),
    );
    expect(abortAllScheduledJobExecutions()).toBe(1);

    await expect(releaseStaleScheduledProjectionOwners()).rejects.toThrow(
      'scheduled_projection_recovery_active_execution',
    );
    expect(recoveredConversation(conversationId).modelProjectionOwner).toBeDefined();

    registration.unregister();
    await expect(releaseStaleScheduledProjectionOwners()).resolves.toBe(1);
    expect(recoveredConversation(conversationId).modelProjectionOwner).toBeUndefined();
  });
});
