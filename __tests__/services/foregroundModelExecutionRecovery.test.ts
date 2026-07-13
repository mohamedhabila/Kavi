import {
  applyForegroundModelRecoveryPlan,
  planForegroundModelRestartRecovery,
  recoverInterruptedForegroundModelExecutions,
  type ForegroundModelRecoveryDependencies,
} from '../../src/services/executionJournal/foregroundModelExecutionRecovery';
import type { ForegroundModelExecutionLease } from '../../src/services/executionJournal/foregroundModelExecutionTypes';
import type { Conversation } from '../../src/types/conversation';

const DIGEST = 'a'.repeat(64);

function lease(
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

function conversation(overrides: Partial<Conversation> = {}): Conversation {
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

function harness(
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

describe('foreground model restart recovery planning', () => {
  it('looks up a chitchat tool effect by the exact foreground execution run', () => {
    const resolveToolEffect = jest.fn(() => ({ kind: 'verified' as const, observedAt: 10 }));
    const ownedConversation = conversation({
      messages: [
        { id: 'request-1', role: 'user', content: 'Do the work.', timestamp: 1 },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [{ id: 'tool-1', name: 'send_email', arguments: '{}', status: 'running' }],
        },
      ],
    });

    planForegroundModelRestartRecovery(lease(), ownedConversation, resolveToolEffect);

    expect(resolveToolEffect).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      executionRunId: 'run-1',
      toolCallId: 'tool-1',
      toolName: 'send_email',
      argumentsText: '{}',
    });
  });

  it('looks up a tracked-agent tool effect by the foreground run, not the agent run', () => {
    const resolveToolEffect = jest.fn(() => ({ kind: 'verified' as const, observedAt: 10 }));
    const trackedLease = lease({ taskId: 'agent-run-1' });
    const ownedConversation = conversation({
      agentRuns: [
        {
          id: 'agent-run-1',
          userMessageId: 'request-1',
          goal: 'Do the work.',
          status: 'running',
          createdAt: 1,
          updatedAt: 2,
          currentPhase: 'work',
          phases: [],
          checkpoints: [],
          summary: {
            assistantTurns: 1,
            startedTools: 1,
            completedTools: 0,
            failedTools: 0,
            spawnedSubAgents: 0,
          },
        },
      ],
      messages: [
        { id: 'request-1', role: 'user', content: 'Do the work.', timestamp: 1 },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [{ id: 'tool-1', name: 'send_email', arguments: '{}', status: 'running' }],
        },
      ],
    });

    planForegroundModelRestartRecovery(trackedLease, ownedConversation, resolveToolEffect);

    expect(resolveToolEffect).toHaveBeenCalledWith(
      expect.objectContaining({ executionRunId: 'run-1' }),
    );
    expect(resolveToolEffect).not.toHaveBeenCalledWith(
      expect.objectContaining({ executionRunId: 'agent-run-1' }),
    );
  });

  it.each([
    ['conversation_missing', lease(), undefined],
    ['conversation_ownership_mismatch', lease(), conversation({ id: 'conversation-2' })],
    [
      'request_message_missing',
      lease(),
      conversation({
        messages: [{ id: 'assistant-1', role: 'assistant', content: '', timestamp: 2 }],
      }),
    ],
    [
      'assistant_anchor_missing',
      lease(),
      conversation({
        messages: [
          { id: 'request-1', role: 'user', content: 'Do the work.', timestamp: 1 },
          { id: 'assistant-2', role: 'assistant', content: '', timestamp: 2 },
        ],
      }),
    ],
    ['task_ownership_missing', lease({ taskId: 'agent-run-1' }), conversation({ agentRuns: [] })],
    [
      'task_ownership_missing',
      lease({ taskId: 'agent-run-1' }),
      conversation({
        agentRuns: [
          {
            id: 'agent-run-1',
            userMessageId: 'different-request',
            goal: 'Unrelated work',
            status: 'running',
            createdAt: 1,
            updatedAt: 2,
            currentPhase: 'work',
            phases: [],
            checkpoints: [],
            summary: {
              assistantTurns: 0,
              startedTools: 0,
              completedTools: 0,
              failedTools: 0,
              spawnedSubAgents: 0,
            },
          },
        ],
      }),
    ],
    ['projection_owner_missing', lease(), conversation({ modelProjectionOwner: undefined })],
    [
      'projection_owner_changed',
      lease(),
      conversation({
        modelProjectionOwner: {
          surface: 'foreground',
          runId: 'newer-run',
          requestMessageId: 'request-1',
          assistantMessageId: 'assistant-1',
          controlEpoch: 0,
        },
      }),
    ],
  ] as const)('blocks %s without mutating a different projection', (reason, runLease, chat) => {
    expect(planForegroundModelRestartRecovery(runLease, chat)).toEqual({
      kind: 'blocked',
      runId: runLease.runId,
      reason,
    });
  });

  it('accepts a complete final projection only when no unresolved tool remains active', () => {
    const completeConversation = conversation({
      messages: [
        { id: 'request-1', role: 'user', content: 'Do the work.', timestamp: 1 },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Done.',
          timestamp: 2,
          assistantMetadata: { kind: 'final', completionStatus: 'complete' },
        },
      ],
    });
    expect(planForegroundModelRestartRecovery(lease(), completeConversation)).toEqual(
      expect.objectContaining({
        status: 'succeeded',
        projectionMessageId: 'assistant-1',
        interruptedTools: [],
      }),
    );

    completeConversation.messages = [
      completeConversation.messages[0],
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 2,
        assistantMetadata: { kind: 'intermediate', completionStatus: 'complete' },
        toolCalls: [
          {
            id: 'tool-1',
            name: 'send_email',
            arguments: '{}',
            status: 'running',
          },
        ],
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        content: 'Done.',
        timestamp: 3,
        assistantMetadata: { kind: 'final', completionStatus: 'complete' },
      },
    ];
    expect(planForegroundModelRestartRecovery(lease(), completeConversation)).toEqual(
      expect.objectContaining({ status: 'failed' }),
    );

    expect(
      planForegroundModelRestartRecovery(lease(), completeConversation, () => ({
        kind: 'verified',
        observedAt: 10,
      })),
    ).toEqual(
      expect.objectContaining({
        status: 'succeeded',
        interruptedTools: [
          expect.objectContaining({
            toolCallId: 'tool-1',
            disposition: { kind: 'verified', observedAt: 10 },
          }),
        ],
      }),
    );
  });

  it('keeps the exact projection open while a tool effect still requires reconciliation', () => {
    const pendingConversation = conversation({
      messages: [
        { id: 'request-1', role: 'user', content: 'Do the work.', timestamp: 1 },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Done.',
          timestamp: 2,
          assistantMetadata: { kind: 'final', completionStatus: 'complete' },
          toolCalls: [{ id: 'tool-1', name: 'send_email', arguments: '{}', status: 'running' }],
        },
      ],
    });

    expect(
      planForegroundModelRestartRecovery(lease(), pendingConversation, () => ({
        kind: 'reconciliation_required',
        observedAt: 10,
        reason: 'ambiguous_effect',
      })),
    ).toEqual({
      kind: 'blocked',
      runId: 'run-1',
      reason: 'effect_reconciliation_pending',
    });
  });

  it('does not trust an older final when a newer assistant projection is incomplete', () => {
    const recoveryPlan = planForegroundModelRestartRecovery(
      lease(),
      conversation({
        messages: [
          { id: 'request-1', role: 'user', content: 'Do the work.', timestamp: 1 },
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Earlier answer.',
            timestamp: 2,
            assistantMetadata: { kind: 'final', completionStatus: 'complete' },
          },
          {
            id: 'assistant-2',
            role: 'assistant',
            content: 'Newer partial answer',
            timestamp: 3,
            assistantMetadata: { kind: 'final', completionStatus: 'incomplete' },
          },
        ],
      }),
    );

    expect(recoveryPlan).toEqual(
      expect.objectContaining({ status: 'failed', projectionMessageId: 'assistant-2' }),
    );
  });

  it('never claims an active tool call that precedes this generation assistant anchor', () => {
    const anchoredLease = lease({ assistantMessageId: 'assistant-2' });
    const recoveryPlan = planForegroundModelRestartRecovery(
      anchoredLease,
      conversation({
        modelProjectionOwner: {
          surface: 'foreground',
          runId: anchoredLease.runId,
          requestMessageId: anchoredLease.requestMessageId,
          assistantMessageId: anchoredLease.assistantMessageId,
          controlEpoch: anchoredLease.controlEpoch,
        },
        messages: [
          { id: 'request-1', role: 'user', content: 'Do the work.', timestamp: 1 },
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            timestamp: 2,
            toolCalls: [
              { id: 'older-tool', name: 'send_email', arguments: '{}', status: 'running' },
            ],
          },
          {
            id: 'assistant-2',
            role: 'assistant',
            content: 'Current partial answer',
            timestamp: 3,
          },
        ],
      }),
    );

    expect(recoveryPlan).toEqual(
      expect.objectContaining({
        status: 'failed',
        projectionMessageId: 'assistant-2',
        interruptedTools: [],
      }),
    );
  });
});

describe('foreground model restart recovery execution', () => {
  it('retains an unresolved generation without mutating or closing its projection', async () => {
    const test = harness(
      conversation({
        messages: [
          { id: 'request-1', role: 'user', content: 'Do the work.', timestamp: 1 },
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            timestamp: 2,
            toolCalls: [{ id: 'tool-1', name: 'send_email', arguments: '{}', status: 'running' }],
          },
        ],
      }),
      [lease()],
      () => ({
        kind: 'reconciliation_required',
        observedAt: 10,
        reason: 'ambiguous_effect',
      }),
    );

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'blocked', runId: 'run-1', reason: 'effect_reconciliation_pending' },
    ]);
    expect(test.getConversation().messages[1]?.toolCalls?.[0]?.status).toBe('running');
    expect(test.complete).not.toHaveBeenCalled();
    expect(test.releaseProjection).not.toHaveBeenCalled();
    expect(test.flushChatState).not.toHaveBeenCalled();
  });

  it('leaves task-owned tool projection and counting to AgentRun recovery', async () => {
    const taskLease = lease({ taskId: 'agent-run-1' });
    const test = harness(
      conversation({
        agentRuns: [
          {
            id: 'agent-run-1',
            userMessageId: 'request-1',
            goal: 'Send the email.',
            status: 'running',
            createdAt: 1,
            updatedAt: 2,
            currentPhase: 'work',
            phases: [],
            checkpoints: [],
            summary: {
              assistantTurns: 1,
              startedTools: 1,
              completedTools: 0,
              failedTools: 0,
              spawnedSubAgents: 0,
            },
          },
        ],
        messages: [
          { id: 'request-1', role: 'user', content: 'Do the work.', timestamp: 1 },
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            timestamp: 2,
            toolCalls: [{ id: 'tool-1', name: 'send_email', arguments: '{}', status: 'running' }],
          },
        ],
      }),
      [taskLease],
      () => ({ kind: 'verified', observedAt: 10 }),
    );

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'recovered', runId: 'run-1', status: 'failed' },
    ]);
    expect(test.getConversation().messages[1]?.toolCalls?.[0]?.status).toBe('running');
    expect(test.getConversation().agentRuns?.[0]?.summary).toMatchObject({
      completedTools: 0,
      failedTools: 0,
    });
  });

  it('persists an interrupted projection before atomically closing its generation', async () => {
    const test = harness(
      conversation({
        messages: [
          { id: 'request-1', role: 'user', content: 'Do the work.', timestamp: 1 },
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            timestamp: 2,
            toolCalls: [
              {
                id: 'tool-1',
                name: 'send_email',
                arguments: '{}',
                status: 'running',
              },
            ],
          },
        ],
      }),
    );

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'recovered', runId: 'run-1', status: 'failed' },
    ]);

    expect(test.mutateProjection).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1' }),
      20,
    );
    expect(test.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        lease: expect.objectContaining({ runId: 'run-1' }),
        status: 'failed',
        projectionMessageId: 'assistant-1',
        projectionState: expect.objectContaining({ recovery: 'app_restart_projection' }),
      }),
    );
    expect(test.flushChatState.mock.invocationCallOrder[0]).toBeLessThan(
      test.complete.mock.invocationCallOrder[0],
    );
    expect(test.complete.mock.invocationCallOrder[0]).toBeLessThan(
      test.releaseProjection.mock.invocationCallOrder[0],
    );
    expect(test.flushChatState).toHaveBeenCalledTimes(2);
    expect(test.getConversation().messages[1]).toEqual(
      expect.objectContaining({
        content: 'Response interrupted because the app restarted before completion.',
        assistantMetadata: expect.objectContaining({ finishReason: 'app_restarted' }),
        toolCalls: [expect.objectContaining({ status: 'failed', completedAt: 20 })],
      }),
    );
  });

  it('closes an already durable complete response without rewriting it', async () => {
    const test = harness(
      conversation({
        messages: [
          { id: 'request-1', role: 'user', content: 'Do the work.', timestamp: 1 },
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Done.',
            timestamp: 2,
            assistantMetadata: { kind: 'final', completionStatus: 'complete' },
          },
        ],
      }),
    );

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'recovered', runId: 'run-1', status: 'succeeded' },
    ]);
    expect(test.mutateProjection).toHaveBeenCalledTimes(1);
    expect(test.flushChatState).toHaveBeenCalledTimes(2);
    expect(test.complete).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded' }));
    expect(test.releaseProjection).toHaveBeenCalledTimes(1);
  });

  it('does not close the journal when the repaired chat projection cannot be flushed', async () => {
    const test = harness(conversation());
    test.flushChatState.mockRejectedValueOnce(new Error('disk full'));

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'blocked', runId: 'run-1', reason: 'journal_unavailable' },
    ]);
    expect(test.complete).not.toHaveBeenCalled();
    expect(test.releaseProjection).not.toHaveBeenCalled();
  });

  it('reports a stale generation without retrying model or tool execution', async () => {
    const test = harness(conversation());
    test.complete.mockRejectedValueOnce(new Error('foreground_model_journal_generation_changed'));

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'blocked', runId: 'run-1', reason: 'generation_changed' },
    ]);
    expect(test.complete).toHaveBeenCalledTimes(1);
    expect(test.releaseProjection).not.toHaveBeenCalled();
  });

  it('propagates an unavailable candidate query instead of claiming no recovery work', async () => {
    const test = harness(conversation());
    test.dependencies.listPending = () => {
      throw new Error('journal unavailable');
    };
    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).rejects.toThrow(
      'journal unavailable',
    );
  });

  it('cancels an unclaimed queued generation without mutating or flushing chat state', async () => {
    const queuedLease = lease({ expectedStatus: 'queued' });
    const test = harness(conversation({ modelProjectionOwner: undefined }), [queuedLease]);

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'recovered', runId: 'run-1', status: 'cancelled' },
    ]);
    expect(test.complete).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    expect(test.flushChatState).not.toHaveBeenCalled();
    expect(test.releaseProjection).toHaveBeenCalledTimes(1);
  });

  it('advances a fair cursor past a full blocked page to recover later generations', async () => {
    const leases = Array.from({ length: 33 }, (_, index) =>
      lease({ runId: `run-${index + 1}`, createdAt: index + 1 }),
    );
    const last = leases.at(-1)!;
    const ownedConversation = conversation({
      modelProjectionOwner: {
        surface: 'foreground',
        runId: last.runId,
        requestMessageId: last.requestMessageId,
        assistantMessageId: last.assistantMessageId,
        controlEpoch: last.controlEpoch,
      },
    });
    const test = harness(ownedConversation, leases);
    test.dependencies.mutateProjection = async (candidate) => {
      if (candidate.runId !== last.runId) {
        return { kind: 'blocked', runId: candidate.runId, reason: 'projection_owner_changed' };
      }
      const plan = planForegroundModelRestartRecovery(candidate, ownedConversation);
      if ('kind' in plan) return plan;
      return { kind: 'applied', plan, conversation: ownedConversation };
    };

    const results = await recoverInterruptedForegroundModelExecutions(test.dependencies);

    expect(test.listPending).toHaveBeenCalledTimes(2);
    expect(results).toContainEqual({
      kind: 'recovered',
      runId: last.runId,
      status: 'failed',
    });
  });
});
