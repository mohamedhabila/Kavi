import {
  recoverInterruptedForegroundModelExecutions,
  type ForegroundModelRecoveryDependencies,
  type ForegroundModelRecoveryPlan,
} from '../../src/services/executionJournal/foregroundModelExecutionRecovery';
import type { ForegroundModelExecutionLease } from '../../src/services/executionJournal/foregroundModelExecutionTypes';
import type { Conversation } from '../../src/types/conversation';

const DIGEST = 'a'.repeat(64);

function lease(
  overrides: Partial<ForegroundModelExecutionLease> = {},
): ForegroundModelExecutionLease {
  return {
    runId: 'foreground-run-1',
    conversationId: 'conversation-1',
    requestMessageId: 'request-1',
    assistantMessageId: 'assistant-1',
    taskId: 'agent-run-1',
    createdAt: 1,
    expectedStatus: 'running',
    controlEpoch: 0,
    updatedAt: 10,
    checkpointId: 'checkpoint-1',
    checkpointStateDigest: DIGEST,
    ...overrides,
  };
}

function conversation(): Conversation {
  return {
    id: 'conversation-1',
    title: 'Conversation',
    providerId: 'provider-1',
    systemPrompt: 'Be helpful.',
    createdAt: 1,
    updatedAt: 2,
    messages: [
      { id: 'request-1', role: 'user', content: 'Do the work.', timestamp: 1 },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Done.',
        timestamp: 2,
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
      },
    ],
  };
}

function recoveryHarness(params: { status?: 'succeeded' | 'failed' } = {}) {
  const runLease = lease();
  const status = params.status ?? 'succeeded';
  const plan: ForegroundModelRecoveryPlan = {
    lease: runLease,
    status,
    projectionMessageId: 'assistant-1',
    shouldInsertInterruptionText: false,
    interruptedTools: [],
  };
  const events: string[] = [];
  const flushChatState = jest.fn(async () => {
    events.push('flush');
  });
  const complete = jest.fn(async () => {
    events.push('complete');
  });
  const releaseProjection = jest.fn(() => {
    events.push('release');
    return 'released' as const;
  });
  const recordConversationTurnMemory = jest.fn(() => {
    events.push('capture');
  });
  const dependencies: ForegroundModelRecoveryDependencies = {
    listPending: ({ after }) => (after ? [] : [runLease]),
    mutateProjection: async () => {
      events.push('mutate');
      return { kind: 'applied', plan, conversation: conversation() };
    },
    flushChatState,
    recordConversationTurnMemory,
    complete,
    releaseProjection,
    isCurrentProcessRun: () => false,
    clock: () => 20,
  };
  return {
    complete,
    dependencies,
    events,
    flushChatState,
    recordConversationTurnMemory,
    releaseProjection,
  };
}

describe('foreground model recovery turn capture', () => {
  it('captures a recovered final once its journal entry and projection are released', async () => {
    const test = recoveryHarness();

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'recovered', runId: 'foreground-run-1', status: 'succeeded' },
    ]);

    expect(test.recordConversationTurnMemory).toHaveBeenCalledWith('conversation-1', 'assistant-1');
    expect(test.events).toEqual(['mutate', 'flush', 'complete', 'release', 'capture', 'flush']);
  });

  it('never captures a failed recovery projection', async () => {
    const test = recoveryHarness({ status: 'failed' });

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'recovered', runId: 'foreground-run-1', status: 'failed' },
    ]);
    expect(test.recordConversationTurnMemory).not.toHaveBeenCalled();
  });

  it('does not capture when the projection changed hands before release', async () => {
    const test = recoveryHarness();
    test.releaseProjection.mockReturnValue('generation_changed' as never);

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'blocked', runId: 'foreground-run-1', reason: 'generation_changed' },
    ]);
    expect(test.recordConversationTurnMemory).not.toHaveBeenCalled();
  });
});
