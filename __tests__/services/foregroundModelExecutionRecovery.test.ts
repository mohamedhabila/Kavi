import { planForegroundModelRestartRecovery } from '../../src/services/executionJournal/foregroundModelExecutionRecovery';
import { conversation, lease } from '../helpers/foregroundModelRecoveryFixtures';

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
          assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
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
        assistantMetadata: {
          kind: 'intermediate',
          completionStatus: 'complete',
          finishReason: 'tool_calls',
        },
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
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
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

  it('closes an interrupted effect as possibly applied instead of waiting for a reconciler', () => {
    const pendingConversation = conversation({
      messages: [
        { id: 'request-1', role: 'user', content: 'Do the work.', timestamp: 1 },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Done.',
          timestamp: 2,
          assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
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
    ).toEqual(
      expect.objectContaining({
        status: 'failed',
        projectionMessageId: 'assistant-1',
        interruptedTools: [
          expect.objectContaining({
            toolCallId: 'tool-1',
            disposition: expect.objectContaining({ kind: 'reconciliation_required' }),
          }),
        ],
      }),
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
            assistantMetadata: {
              kind: 'final',
              completionStatus: 'complete',
              finishReason: 'stop',
            },
          },
          {
            id: 'assistant-2',
            role: 'assistant',
            content: 'Newer partial answer',
            timestamp: 3,
            assistantMetadata: {
              kind: 'final',
              completionStatus: 'incomplete',
              finishReason: 'response_failed',
            },
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
