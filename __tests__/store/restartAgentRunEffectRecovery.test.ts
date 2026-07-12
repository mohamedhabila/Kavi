import {
  createInitialAgentRunControlGraphState,
  updateAgentRunControlGraphAsyncWorkState,
} from '../../src/services/agents/agentControlGraphState';
import { reduceAgentControlGraph } from '../../src/engine/graph/agentControlGraph';
import { prepareAgentRunResumeForOrchestrator } from '../../src/engine/graph/runResumePreparation';
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
  const agentRun = run();
  if (options.completeFinal) {
    agentRun.controlGraph = createInitialAgentRunControlGraphState({
      status: 'awaiting_review',
      updatedAt: 2,
    });
  }
  return {
    id: 'conversation-1',
    title: 'Conversation',
    providerId: 'provider-1',
    systemPrompt: 'Be helpful.',
    createdAt: 1,
    updatedAt: 2,
    activeAgentRunId: 'run-1',
    agentRuns: [agentRun],
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

function preservedFinalConversationAtUnsafeGraphBoundary(
  status: 'awaiting_tool_results' | 'model_turn',
): Conversation {
  const chat = conversation({ completeFinal: true });
  chat.messages[1] = { ...chat.messages[1], toolCalls: undefined };
  chat.agentRuns![0] = {
    ...chat.agentRuns![0],
    controlGraph: createInitialAgentRunControlGraphState({
      status,
      expectedToolCalls:
        status === 'awaiting_tool_results'
          ? [{ id: 'unsettled-tool-call', name: 'calendar_create_event' }]
          : [],
      updatedAt: 2,
    }),
  };
  return chat;
}

const executionRunOwners = new Map([
  ['conversation-1', new Map([['run-1', 'foreground-execution-1']])],
]);

describe('agent-run restart effect reconciliation', () => {
  it('counts a durably verified effect as completed while leaving the interrupted run failed', () => {
    const resolveToolEffect = jest.fn(() => ({ kind: 'verified' as const, observedAt: 150 }));
    const recovered = recoverInterruptedAgentRunsInConversation(conversation(), [], {
      timestamp: 200,
      executionRunIdByConversationAndAgentRun: executionRunOwners,
      resolveToolEffect,
    });
    const recoveredRun = recovered.agentRuns?.[0];
    const toolCall = recovered.messages[1]?.toolCalls?.[0];

    expect(recoveredRun).toMatchObject({
      status: 'failed',
      summary: { startedTools: 1, completedTools: 1, failedTools: 0 },
    });
    expect(toolCall).toMatchObject({ status: 'completed', completedAt: 150 });
    expect(toolCall?.result).toContain('durably verified');
    expect(resolveToolEffect).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        executionRunId: 'foreground-execution-1',
        toolCallId: 'tool-call-1',
      }),
    );
  });

  it('fails closed when a running agent has no exact foreground execution owner', () => {
    const resolveToolEffect = jest.fn(() => ({ kind: 'not_dispatched' as const }));

    const recovered = recoverInterruptedAgentRunsInConversation(conversation(), [], {
      timestamp: 200,
      resolveToolEffect,
    });

    expect(recovered.agentRuns?.[0]).toMatchObject({
      status: 'running',
      controlGraph: { status: 'recovering' },
    });
    expect(recovered.messages[1]?.toolCalls?.[0]).toMatchObject({ status: 'running' });
    expect(resolveToolEffect).not.toHaveBeenCalled();
  });

  it('keeps an ambiguous effect recoverable without terminalizing the run', () => {
    const recovered = recoverInterruptedAgentRunsInConversation(conversation(), [], {
      timestamp: 200,
      executionRunIdByConversationAndAgentRun: executionRunOwners,
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
        executionRunIdByConversationAndAgentRun: executionRunOwners,
        resolveToolEffect: () => ({ kind: 'verified', observedAt: 150 }),
      },
    );

    expect(recovered.agentRuns?.[0]).toMatchObject({
      status: 'completed',
      controlGraph: { status: 'finalized' },
      latestSummary: 'Created.',
      summary: { completedTools: 1, failedTools: 0 },
    });
  });

  it('fails both the run and graph when a preserved final is newer than an unsafe model turn', () => {
    const recovered = recoverInterruptedAgentRunsInConversation(
      preservedFinalConversationAtUnsafeGraphBoundary('model_turn'),
      [],
      { timestamp: 200 },
    );
    const recoveredRun = recovered.agentRuns?.[0];

    expect(recoveredRun).toMatchObject({
      status: 'failed',
      controlGraph: {
        status: 'failed',
        expectedToolCalls: [],
        observedToolResults: [],
        pendingAsyncCount: 0,
        asyncWork: { awaitingBackgroundWorkers: false, pendingOperations: [] },
      },
    });
    expect(recoveredRun?.controlGraph?.audit.at(-1)).toMatchObject({
      type: 'FAILED',
      timestamp: 200,
    });

    const resumed = prepareAgentRunResumeForOrchestrator({
      existingRun: recoveredRun,
      messages: recovered.messages,
      updatedAt: 201,
    });
    expect(resumed.initialAgentControlGraphState).toMatchObject({
      status: 'ready',
      terminalReason: undefined,
    });
  });

  it('fails both the run and graph when a preserved final has unsettled tool results', () => {
    const recovered = recoverInterruptedAgentRunsInConversation(
      preservedFinalConversationAtUnsafeGraphBoundary('awaiting_tool_results'),
      [],
      { timestamp: 200 },
    );

    expect(recovered.agentRuns?.[0]).toMatchObject({
      status: 'failed',
      controlGraph: {
        status: 'failed',
        expectedToolCalls: [],
        observedToolResults: [],
        pendingAsyncCount: 0,
        asyncWork: { awaitingBackgroundWorkers: false, pendingOperations: [] },
      },
    });
    expect(recovered.agentRuns?.[0]?.controlGraph?.audit.at(-1)).toMatchObject({
      type: 'FAILED',
      timestamp: 200,
    });
  });

  it('preserves a graph cancellation that was persisted before its run projection', () => {
    const chat = conversation();
    const cancelledGraph = reduceAgentControlGraph(chat.agentRuns?.[0]?.controlGraph, [
      { type: 'CANCELLED', reason: 'User stopped the run.', timestamp: 150 },
    ]);
    chat.agentRuns![0] = { ...chat.agentRuns![0], controlGraph: cancelledGraph };

    const recovered = recoverInterruptedAgentRunsInConversation(chat, [], { timestamp: 200 });

    expect(recovered.agentRuns?.[0]).toMatchObject({
      status: 'cancelled',
      completedAt: 200,
      latestSummary: 'User stopped the run.',
      controlGraph: { status: 'cancelled' },
    });
    expect(recovered.agentRuns?.[0]?.controlGraph).toEqual(cancelledGraph);
    expect(recovered.messages[1]?.toolCalls?.[0]).toMatchObject({ status: 'failed' });
    expect(recovered.activeAgentRunId).toBeUndefined();
  });

  it.each(['failed', 'blocked'] as const)(
    'preserves a %s graph that was persisted before its failed run projection',
    (graphStatus) => {
      const chat = conversation();
      const terminalGraph = reduceAgentControlGraph(chat.agentRuns?.[0]?.controlGraph, [
        graphStatus === 'failed'
          ? { type: 'FAILED', reason: 'Provider execution failed.', timestamp: 150 }
          : { type: 'BLOCKED', reason: 'Required authority is unavailable.', timestamp: 150 },
      ]);
      chat.agentRuns![0] = { ...chat.agentRuns![0], controlGraph: terminalGraph };

      const recovered = recoverInterruptedAgentRunsInConversation(chat, [], { timestamp: 200 });

      expect(recovered.agentRuns?.[0]).toMatchObject({
        status: 'failed',
        completedAt: 200,
        controlGraph: { status: graphStatus },
      });
      expect(recovered.agentRuns?.[0]?.controlGraph).toEqual(terminalGraph);
      expect(recovered.messages[1]?.toolCalls?.[0]).toMatchObject({ status: 'failed' });
      expect(recovered.activeAgentRunId).toBeUndefined();
    },
  );

  it('fails the graph when persisted completion reconciliation fails closed', () => {
    const chat = conversation({ completeFinal: true });
    chat.messages[1] = { ...chat.messages[1], toolCalls: undefined };
    chat.agentRuns![0] = {
      ...chat.agentRuns![0],
      controlGraph: createInitialAgentRunControlGraphState({
        status: 'awaiting_review',
        goals: [
          {
            id: 'deliver',
            title: 'Deliver the verified result',
            status: 'completed',
            dependencies: [],
            evidence: ['verified'],
            successCriteria: ['evidence.tool:calendar_create_event'],
            completionPolicy: 'blocking',
            userConstraintDeliveryPending: true,
            userConstraintIntegrity: 'conflict',
            createdAt: 1,
            updatedAt: 2,
            completedAt: 2,
          },
        ],
        updatedAt: 2,
      }),
    };

    const recovered = recoverInterruptedAgentRunsInConversation(chat, [], { timestamp: 200 });

    expect(recovered.agentRuns?.[0]).toMatchObject({
      status: 'failed',
      latestSummary: expect.stringContaining('completion boundary could not be verified'),
      controlGraph: {
        status: 'failed',
        terminalReason: expect.stringContaining('completion boundary could not be verified'),
      },
    });
    expect(recovered.agentRuns?.[0]?.controlGraph?.audit.at(-1)).toMatchObject({
      type: 'FAILED',
      timestamp: 200,
    });
  });

  it('requires a fresh review boundary after an ambiguous effect is later verified', () => {
    const recovered = recoverInterruptedAgentRunsInConversation(
      conversation({ completeFinal: true }),
      [],
      {
        timestamp: 200,
        executionRunIdByConversationAndAgentRun: executionRunOwners,
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
      executionRunIdByConversationAndAgentRun: executionRunOwners,
      resolveToolEffect: () => ({ kind: 'verified', observedAt: 250 }),
    });
    expect(verified.agentRuns?.[0]).toMatchObject({
      status: 'running',
      currentPhase: 'review',
      latestSummary: expect.stringContaining('recovery boundary still requires review'),
      controlGraph: { status: 'recovering' },
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
        executionRunIdByConversationAndAgentRun: executionRunOwners,
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
        executionRunIdByConversationAndAgentRun: executionRunOwners,
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
