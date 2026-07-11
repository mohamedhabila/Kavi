import { createInitialAgentRunControlGraphState } from '../../src/services/agents/agentControlGraphState';
import { recoverInterruptedAgentRunsInConversation } from '../../src/store/agentRuns/recovery';
import type { AgentRun } from '../../src/types/agentRun';
import type { Conversation } from '../../src/types/conversation';

function run(): AgentRun {
  return {
    id: 'run-1',
    userMessageId: 'user-1',
    goal: 'Create the event.',
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
    controlGraph: createInitialAgentRunControlGraphState({ updatedAt: 2 }),
  };
}

function conversation(options: { completeFinal?: boolean } = {}): Conversation {
  return {
    id: 'conversation-1',
    title: 'Conversation',
    providerId: 'provider-1',
    systemPrompt: 'Be helpful.',
    createdAt: 1,
    updatedAt: 2,
    activeAgentRunId: 'run-1',
    agentRuns: [run()],
    messages: [
      { id: 'user-1', role: 'user', content: 'Create it.', timestamp: 1 },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 2,
        assistantMetadata: { kind: 'intermediate', completionStatus: 'complete' },
        toolCalls: [
          {
            id: 'tool-call-1',
            name: 'calendar_create_event',
            arguments: '{}',
            status: 'running',
            startedAt: 10,
          },
        ],
      },
      ...(options.completeFinal
        ? [
            {
              id: 'assistant-final',
              role: 'assistant' as const,
              content: 'Created.',
              timestamp: 3,
              assistantMetadata: {
                kind: 'final' as const,
                completionStatus: 'complete' as const,
              },
            },
          ]
        : []),
    ],
  };
}

describe('agent-run restart effect reconciliation', () => {
  it('counts a durably verified effect as completed while leaving the interrupted run failed', () => {
    const recovered = recoverInterruptedAgentRunsInConversation(conversation(), [], {
      timestamp: 200,
      resolveToolEffect: () => ({ kind: 'verified', observedAt: 150 }),
    });
    const recoveredRun = recovered.agentRuns?.[0];
    const toolCall = recovered.messages[1]?.toolCalls?.[0];

    expect(recoveredRun).toMatchObject({
      status: 'failed',
      summary: { startedTools: 1, completedTools: 1, failedTools: 0 },
    });
    expect(toolCall).toMatchObject({ status: 'completed', completedAt: 150 });
    expect(toolCall?.result).toContain('durably verified');
  });

  it('counts an ambiguous effect as failed and requires reconciliation', () => {
    const recovered = recoverInterruptedAgentRunsInConversation(conversation(), [], {
      timestamp: 200,
      resolveToolEffect: () => ({
        kind: 'reconciliation_required',
        observedAt: 150,
        reason: 'ambiguous_effect',
      }),
    });
    const recoveredRun = recovered.agentRuns?.[0];
    const toolCall = recovered.messages[1]?.toolCalls?.[0];

    expect(recoveredRun).toMatchObject({
      status: 'failed',
      summary: { startedTools: 1, completedTools: 0, failedTools: 1 },
    });
    expect(toolCall).toMatchObject({ status: 'failed', failureKind: 'runtime_error' });
    expect(toolCall?.error).toContain('requires reconciliation before any retry');
  });

  it('keeps a preserved final response completed only when its active effect is verified', () => {
    const recovered = recoverInterruptedAgentRunsInConversation(
      conversation({ completeFinal: true }),
      [],
      {
        timestamp: 200,
        resolveToolEffect: () => ({ kind: 'verified', observedAt: 150 }),
      },
    );

    expect(recovered.agentRuns?.[0]).toMatchObject({
      status: 'completed',
      latestSummary: 'Created.',
      summary: { completedTools: 1, failedTools: 0 },
    });
  });

  it('revokes a preserved completion when the linked effect is ambiguous', () => {
    const recovered = recoverInterruptedAgentRunsInConversation(
      conversation({ completeFinal: true }),
      [],
      {
        timestamp: 200,
        resolveToolEffect: () => ({
          kind: 'reconciliation_required',
          observedAt: 150,
          reason: 'ambiguous_effect',
        }),
      },
    );

    expect(recovered.agentRuns?.[0]).toMatchObject({
      status: 'failed',
      latestSummary:
        'A final response was preserved, but an active tool lacked a verified terminal effect after restart.',
      summary: { completedTools: 0, failedTools: 1 },
    });
  });
});
