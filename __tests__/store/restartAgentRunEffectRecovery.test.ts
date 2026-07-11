import {
  createInitialAgentRunControlGraphState,
  updateAgentRunControlGraphAsyncWorkState,
} from '../../src/services/agents/agentControlGraphState';
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

  it('keeps an ambiguous effect recoverable without terminalizing the run', () => {
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
      status: 'running',
      summary: { startedTools: 1, completedTools: 0, failedTools: 0 },
      controlGraph: { status: 'recovering' },
    });
    expect(toolCall).toMatchObject({ status: 'running' });
    expect(toolCall?.error).toBeUndefined();
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

  it('keeps a preserved completion pending until the linked effect is verified', () => {
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
      status: 'running',
      latestSummary: expect.stringContaining('Waiting for durable tool-effect reconciliation'),
      summary: { completedTools: 0, failedTools: 0 },
    });

    const verified = recoverInterruptedAgentRunsInConversation(recovered, [], {
      timestamp: 300,
      resolveToolEffect: () => ({ kind: 'verified', observedAt: 250 }),
    });
    expect(verified.agentRuns?.[0]).toMatchObject({
      status: 'completed',
      latestSummary: 'Created.',
      summary: { completedTools: 1, failedTools: 0 },
    });
    expect(verified.messages[1]?.toolCalls?.[0]).toMatchObject({
      status: 'completed',
      completedAt: 250,
    });
  });

  it('accounts for a verified tool even while a recovered worker is still active', () => {
    const recovered = recoverInterruptedAgentRunsInConversation(
      conversation(),
      [
        {
          sessionId: 'worker-1',
          parentConversationId: 'conversation-1',
          agentRunId: 'run-1',
          depth: 0,
          startedAt: 10,
          updatedAt: 20,
          status: 'running',
          sandboxPolicy: 'inherit',
        },
      ],
      {
        timestamp: 200,
        resolveToolEffect: () => ({ kind: 'verified', observedAt: 150 }),
      },
    );

    expect(recovered.agentRuns?.[0]).toMatchObject({
      status: 'running',
      summary: { completedTools: 1, failedTools: 0 },
    });
    expect(recovered.messages[1]?.toolCalls?.[0]).toMatchObject({ status: 'completed' });
  });

  it('accounts for a verified tool before returning to background-worker review', () => {
    const chat = conversation();
    const agentRun = chat.agentRuns![0];
    agentRun.controlGraph = updateAgentRunControlGraphAsyncWorkState(agentRun.controlGraph, {
      awaitingBackgroundWorkers: true,
      pendingOperations: [],
      updatedAt: 3,
    });
    const recovered = recoverInterruptedAgentRunsInConversation(
      chat,
      [
        {
          sessionId: 'worker-1',
          parentConversationId: 'conversation-1',
          agentRunId: 'run-1',
          depth: 0,
          startedAt: 10,
          updatedAt: 20,
          status: 'error',
          sandboxPolicy: 'inherit',
          output: 'Provider failed while inspecting the remote state.',
        },
      ],
      {
        timestamp: 200,
        resolveToolEffect: () => ({ kind: 'verified', observedAt: 150 }),
      },
    );

    expect(recovered.agentRuns?.[0]).toMatchObject({
      status: 'running',
      currentPhase: 'review',
      summary: { completedTools: 1, failedTools: 0 },
    });
    expect(recovered.messages[1]?.toolCalls?.[0]).toMatchObject({ status: 'completed' });
  });
});
