import {
  applyForegroundModelRecoveryPlan,
  planForegroundModelRestartRecovery,
  type ForegroundModelRecoveryDependencies,
} from '../../src/services/executionJournal/foregroundModelExecutionRecovery';
import type { ForegroundModelExecutionLease } from '../../src/services/executionJournal/foregroundModelExecutionTypes';
import type { Conversation } from '../../src/types/conversation';

const DIGEST = 'a'.repeat(64);

export function lease(
  overrides: Partial<ForegroundModelExecutionLease> = {},
): ForegroundModelExecutionLease {
  return {
    runId: 'run-1',
    conversationId: 'conversation-1',
    requestMessageId: 'request-1',
    assistantMessageId: 'assistant-1',
    taskId: null,
    createdAt: 1,
    expectedStatus: 'running',
    controlEpoch: 0,
    updatedAt: 10,
    checkpointId: 'checkpoint-1',
    checkpointStateDigest: DIGEST,
    ...overrides,
  };
}

export function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-1',
    title: 'Conversation',
    providerId: 'provider-1',
    systemPrompt: 'Be helpful.',
    createdAt: 1,
    updatedAt: 2,
    messages: [
      { id: 'request-1', role: 'user', content: 'Do the work.', timestamp: 1 },
      { id: 'assistant-1', role: 'assistant', content: '', timestamp: 2 },
    ],
    modelProjectionOwner: {
      surface: 'foreground',
      runId: 'run-1',
      requestMessageId: 'request-1',
      assistantMessageId: 'assistant-1',
      controlEpoch: 0,
    },
    ...overrides,
  };
}

export function harness(
  initialConversation: Conversation,
  leases = [lease()],
  resolveToolEffect: Parameters<typeof planForegroundModelRestartRecovery>[2] = () => ({
    kind: 'not_dispatched',
  }),
) {
  let currentConversation = structuredClone(initialConversation);
  const flushChatState = jest.fn().mockResolvedValue(undefined);
  const complete = jest.fn().mockResolvedValue(undefined);
  const listPending = jest.fn(
    ({ limit, after }: { limit: number; after?: { createdAt: number; runId: string } }) => {
      const start = after
        ? leases.findIndex(
            (candidate) =>
              candidate.createdAt === after.createdAt && candidate.runId === after.runId,
          ) + 1
        : 0;
      return leases.slice(Math.max(0, start), Math.max(0, start) + limit);
    },
  );
  const mutateProjection = jest.fn(
    async (runLease: ForegroundModelExecutionLease, timestamp: number) => {
      const plan = planForegroundModelRestartRecovery(
        runLease,
        currentConversation,
        resolveToolEffect,
      );
      if ('kind' in plan) return plan;
      currentConversation = applyForegroundModelRecoveryPlan(plan, currentConversation, timestamp);
      return { kind: 'applied' as const, plan, conversation: currentConversation };
    },
  );
  const releaseProjection = jest.fn((runLease: ForegroundModelExecutionLease) => {
    if (currentConversation.modelProjectionOwner?.runId !== runLease.runId) {
      return 'owner_changed' as const;
    }
    currentConversation = {
      ...currentConversation,
      modelProjectionOwner: undefined,
    };
    return 'released' as const;
  });
  const dependencies: ForegroundModelRecoveryDependencies = {
    listPending,
    mutateProjection,
    isCurrentProcessRun: () => false,
    flushChatState,
    settleMemoryPublication: async ({ conversationId, sourceEndMessageId }) => ({
      conversationId,
      sourceEndMessageId,
      status: 'unclassified',
    }),
    complete,
    releaseProjection,
    clock: () => 20,
  };
  return {
    complete,
    dependencies,
    flushChatState,
    getConversation: () => currentConversation,
    listPending,
    mutateProjection,
    releaseProjection,
  };
}
