import {
  planForegroundModelRestartRecovery,
  recoverInterruptedForegroundModelExecutions,
  type ForegroundModelRecoveryDependencies,
} from '../../src/services/executionJournal/foregroundModelExecutionRecovery';
import type { ForegroundModelExecutionLease } from '../../src/services/executionJournal/foregroundModelExecutionJournal';
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
    ...overrides,
  };
}

function harness(initialConversation: Conversation, leases = [lease()]) {
  let currentConversation = structuredClone(initialConversation);
  const flushChatState = jest.fn().mockResolvedValue(undefined);
  const complete = jest.fn().mockResolvedValue(undefined);
  const updateMessage = jest.fn((conversationId: string, messageId: string, content: string) => {
    if (currentConversation.id !== conversationId) return;
    currentConversation = {
      ...currentConversation,
      messages: currentConversation.messages.map((message) =>
        message.id === messageId ? { ...message, content } : message,
      ),
    };
  });
  const updateAssistantMetadata = jest.fn((conversationId, messageId, metadata) => {
    if (currentConversation.id !== conversationId) return;
    currentConversation = {
      ...currentConversation,
      messages: currentConversation.messages.map((message) =>
        message.id === messageId ? { ...message, assistantMetadata: metadata } : message,
      ),
    };
  });
  const failToolCall = jest.fn(
    (conversationId: string, assistantMessageId: string, toolCallId: string, completedAt: number) => {
      if (currentConversation.id !== conversationId) return;
      currentConversation = {
        ...currentConversation,
        messages: currentConversation.messages.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                toolCalls: message.toolCalls?.map((toolCall) =>
                  toolCall.id === toolCallId
                    ? {
                        ...toolCall,
                        status: 'failed' as const,
                        error:
                          'Tool execution was interrupted by an app restart. Verify any external effect before retrying.',
                        completedAt,
                      }
                    : toolCall,
                ),
              }
            : message,
        ),
      };
    },
  );
  const appendRecoveryLog = jest.fn();
  const dependencies: ForegroundModelRecoveryDependencies = {
    listPending: () => leases,
    getConversation: (conversationId) =>
      currentConversation.id === conversationId ? currentConversation : undefined,
    updateMessage,
    updateAssistantMetadata,
    failToolCall,
    appendRecoveryLog,
    flushChatState,
    complete,
    clock: () => 20,
  };
  return {
    appendRecoveryLog,
    complete,
    dependencies,
    failToolCall,
    flushChatState,
    getConversation: () => currentConversation,
    updateAssistantMetadata,
    updateMessage,
  };
}

describe('foreground model restart recovery planning', () => {
  it.each([
    ['conversation_missing', lease(), undefined],
    ['conversation_ownership_mismatch', lease(), conversation({ id: 'conversation-2' })],
    [
      'request_message_missing',
      lease(),
      conversation({ messages: [{ id: 'assistant-1', role: 'assistant', content: '', timestamp: 2 }] }),
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
    [
      'task_ownership_missing',
      lease({ taskId: 'agent-run-1' }),
      conversation({ agentRuns: [] }),
    ],
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
  ] as const)('blocks %s without mutating a different projection', (reason, runLease, chat) => {
    expect(planForegroundModelRestartRecovery(runLease, chat)).toEqual({
      kind: 'blocked',
      runId: runLease.runId,
      reason,
    });
  });

  it('accepts a complete final projection only when no tool remains active', () => {
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

    completeConversation.messages[1] = {
      ...completeConversation.messages[1],
      toolCalls: [
        {
          id: 'tool-1',
          name: 'send_email',
          arguments: '{}',
          status: 'running',
        },
      ],
    };
    expect(planForegroundModelRestartRecovery(lease(), completeConversation)).toEqual(
      expect.objectContaining({ status: 'failed' }),
    );
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
});

describe('foreground model restart recovery execution', () => {
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

    expect(test.failToolCall).toHaveBeenCalledWith(
      'conversation-1',
      'assistant-1',
      'tool-1',
      20,
    );
    expect(test.updateMessage).toHaveBeenCalledWith(
      'conversation-1',
      'assistant-1',
      'Response interrupted because the app restarted before completion.',
    );
    expect(test.updateAssistantMetadata).toHaveBeenCalledWith(
      'conversation-1',
      'assistant-1',
      expect.objectContaining({
        kind: 'intermediate',
        completionStatus: 'incomplete',
        finishReason: 'app_restarted',
      }),
    );
    expect(test.appendRecoveryLog).toHaveBeenCalledWith('conversation-1', 20);
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
    expect(test.updateMessage).not.toHaveBeenCalled();
    expect(test.updateAssistantMetadata).not.toHaveBeenCalled();
    expect(test.failToolCall).not.toHaveBeenCalled();
    expect(test.flushChatState).toHaveBeenCalledTimes(1);
    expect(test.complete).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('does not close the journal when the repaired chat projection cannot be flushed', async () => {
    const test = harness(conversation());
    test.flushChatState.mockRejectedValueOnce(new Error('disk full'));

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'blocked', runId: 'run-1', reason: 'journal_unavailable' },
    ]);
    expect(test.complete).not.toHaveBeenCalled();
  });

  it('reports a stale generation without retrying model or tool execution', async () => {
    const test = harness(conversation());
    test.complete.mockRejectedValueOnce(
      new Error('foreground_model_journal_generation_changed'),
    );

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'blocked', runId: 'run-1', reason: 'generation_changed' },
    ]);
    expect(test.complete).toHaveBeenCalledTimes(1);
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
});
