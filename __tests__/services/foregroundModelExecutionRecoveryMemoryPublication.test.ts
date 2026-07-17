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

function conversation(params: { receipt: 'open' | 'absent' }): Conversation {
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
        ...(params.receipt === 'open'
          ? { memoryPublication: { version: 1 as const, disposition: null } }
          : {}),
      },
    ],
  };
}

function recoveryHarness(params: {
  chat: Conversation;
  settlement?: 'terminal' | 'reject';
  status?: 'succeeded' | 'failed';
}) {
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
  const settleMemoryPublication = jest.fn(async () => {
    events.push('settle');
    if (params.settlement === 'reject') {
      throw new Error('memory provider unavailable');
    }
    return {
      conversationId: 'conversation-1',
      sourceEndMessageId: 'assistant-1',
      status: 'settled' as const,
      disposition: 'enqueued' as const,
    };
  });
  const dependencies: ForegroundModelRecoveryDependencies = {
    listPending: ({ after }) => (after ? [] : [runLease]),
    mutateProjection: async () => {
      events.push('mutate');
      return { kind: 'applied', plan, conversation: params.chat };
    },
    flushChatState,
    settleMemoryPublication,
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
    releaseProjection,
    settleMemoryPublication,
  };
}

describe('foreground model recovery memory publication', () => {
  it('settles an open exact final with an existing job before journal completion', async () => {
    const test = recoveryHarness({ chat: conversation({ receipt: 'open' }) });

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'recovered', runId: 'foreground-run-1', status: 'succeeded' },
    ]);

    expect(test.settleMemoryPublication).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      sourceEndMessageId: 'assistant-1',
      sourceRunId: 'agent-run-1',
    });
    expect(test.events).toEqual(['mutate', 'flush', 'settle', 'complete', 'release', 'flush']);
  });

  it('keeps the journal and projection recoverable when publication settlement rejects', async () => {
    const test = recoveryHarness({
      chat: conversation({ receipt: 'open' }),
      settlement: 'reject',
    });

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      {
        kind: 'blocked',
        runId: 'foreground-run-1',
        reason: 'memory_publication_pending',
      },
    ]);

    expect(test.complete).not.toHaveBeenCalled();
    expect(test.releaseProjection).not.toHaveBeenCalled();
    expect(test.flushChatState).toHaveBeenCalledTimes(1);
    expect(test.events).toEqual(['mutate', 'flush', 'settle']);
  });

  it('does not backfill a historical final with no publication receipt', async () => {
    const test = recoveryHarness({ chat: conversation({ receipt: 'absent' }) });

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'recovered', runId: 'foreground-run-1', status: 'succeeded' },
    ]);

    expect(test.settleMemoryPublication).not.toHaveBeenCalled();
    expect(test.events).toEqual(['mutate', 'flush', 'complete', 'release', 'flush']);
  });

  it('never publishes a failed recovery projection', async () => {
    const test = recoveryHarness({
      chat: conversation({ receipt: 'open' }),
      status: 'failed',
    });

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'recovered', runId: 'foreground-run-1', status: 'failed' },
    ]);
    expect(test.settleMemoryPublication).not.toHaveBeenCalled();
  });
});
