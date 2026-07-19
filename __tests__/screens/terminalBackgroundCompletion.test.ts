import { completeTerminalBackgroundReviewRun } from '../../src/screens/terminalBackgroundCompletion';
import { useChatStore } from '../../src/store/useChatStore';
import type { AgentRun } from '../../src/types/agentRun';
import type { Conversation } from '../../src/types/conversation';

function makeRun(): AgentRun {
  return {
    id: 'run-1',
    userMessageId: 'user-1',
    goal: 'Finish constrained background work',
    status: 'running',
    createdAt: 1,
    updatedAt: 2,
    currentPhase: 'review',
    phases: [],
    checkpoints: [],
    summary: {
      assistantTurns: 1,
      startedTools: 1,
      completedTools: 1,
      failedTools: 0,
      spawnedSubAgents: 1,
    },
    controlGraph: {
      version: 1,
      status: 'waiting_async',
      iteration: 1,
      expectedToolCalls: [],
      observedToolResults: [],
      pendingAsyncCount: 0,
      lastModelToolNames: [],
      goals: [
        {
          id: 'deliver',
          title: 'Deliver exact result',
          status: 'completed',
          dependencies: [],
          evidence: ['worker:verified_success'],
          successCriteria: ['evidence.prefix:worker'],
          completionPolicy: 'blocking',
          userConstraints: [{ text: 'Answer in Dutch.', sourceMessageId: 'user-1' }],
          userConstraintDeliveryPending: true,
          createdAt: 1,
          updatedAt: 2,
          completedAt: 2,
        },
      ],
      asyncWork: { awaitingBackgroundWorkers: true, pendingOperations: [], updatedAt: 2 },
      performance: {
        modelTurnCount: 1,
        modelDurationMs: 1,
        toolExecutionCount: 1,
        toolExecutionDurationMs: 1,
        lastCandidateToolCount: 1,
        lastActiveToolCount: 1,
        maxActiveToolCount: 1,
        lastActiveToolTokenEstimate: 1,
        maxActiveToolTokenEstimate: 1,
        updatedAt: 2,
      },
      turnDirectives: {
        forceFinalText: false,
        requireWorkflowTool: false,
        incompleteFinalTextRecoveryCount: 0,
      },
      audit: [],
      updatedAt: 2,
    },
  };
}

describe('terminal background completion', () => {
  it.each(['waiting_async', 'ready'] as const)(
    'acknowledges constrained delivery and terminalizes from a %s background boundary',
    (backgroundStatus) => {
      const run = makeRun();
      run.controlGraph = { ...run.controlGraph!, status: backgroundStatus };
      const conversation: Conversation = {
        id: 'conversation-1',
        title: 'Background completion',
        messages: [
          { id: 'user-1', role: 'user', content: run.goal, timestamp: 1 },
          {
            id: 'final-1',
            role: 'assistant',
            content: 'Het resultaat is geverifieerd.',
            timestamp: 3,
            assistantMetadata: {
              kind: 'final',
              completionStatus: 'complete',
              finishReason: 'stop',
            },
          },
        ],
        createdAt: 1,
        updatedAt: 3,
        agentRuns: [run],
      };
      useChatStore.setState({
        conversations: [conversation],
        activeConversationId: conversation.id,
        isLoading: false,
      });

      expect(
        completeTerminalBackgroundReviewRun({
          appendConversationLog: useChatStore.getState().addConversationLog,
          completeAgentRun: useChatStore.getState().completeAgentRun,
          updateAgentRunControlGraph: useChatStore.getState().updateAgentRunControlGraph,
          completion: {
            status: 'completed',
            latestSummary: 'Het resultaat is geverifieerd.',
            checkpointTitle: 'Background workers finished',
            logLevel: 'info',
            logTitle: 'Background workers finished',
          },
          conversationId: conversation.id,
          reviewTimestamp: 4,
          runId: run.id,
          targetRun: run,
        }),
      ).toBe(true);

      const completedRun = useChatStore.getState().conversations[0].agentRuns?.[0];
      expect(completedRun?.status).toBe('completed');
      expect(completedRun?.controlGraph?.status).toBe('finalized');
      expect(completedRun?.controlGraph?.asyncWork).toMatchObject({
        awaitingBackgroundWorkers: false,
        pendingOperations: [],
      });
      expect(completedRun?.controlGraph?.goals?.[0].userConstraintDeliveryPending).toBeUndefined();
      expect(completedRun?.controlGraph?.goals?.[0]).not.toHaveProperty('userConstraints');
      expect(completedRun?.controlGraph?.audit.slice(-2).map((event) => event.type)).toEqual([
        'USER_CONSTRAINT_DELIVERY_ACKNOWLEDGED',
        'FINALIZED',
      ]);
      expect(completedRun?.controlGraph?.audit.map((event) => event.type)).toEqual(
        expect.arrayContaining(['ASYNC_WAITING', 'FINAL_CANDIDATE_READY']),
      );
    },
  );

  it('does not overwrite an in-flight graph even if stale async state claims workers are done', () => {
    const run = makeRun();
    run.controlGraph = { ...run.controlGraph!, status: 'model_turn' };
    const conversation = {
      id: 'conversation-1',
      title: 'Background completion',
      messages: [
        { id: 'user-1', role: 'user', content: run.goal, timestamp: 1 },
        {
          id: 'final-1',
          role: 'assistant',
          content: 'Earlier final.',
          timestamp: 3,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'stop',
          },
        },
      ],
      createdAt: 1,
      updatedAt: 3,
      agentRuns: [run],
    } as Conversation;
    useChatStore.setState({
      conversations: [conversation],
      activeConversationId: conversation.id,
      isLoading: false,
    });

    expect(
      completeTerminalBackgroundReviewRun({
        appendConversationLog: jest.fn(),
        completeAgentRun: useChatStore.getState().completeAgentRun,
        updateAgentRunControlGraph: useChatStore.getState().updateAgentRunControlGraph,
        completion: {
          status: 'completed',
          latestSummary: 'Earlier final.',
          checkpointTitle: 'Background workers finished',
          logLevel: 'info',
          logTitle: 'Background workers finished',
        },
        conversationId: conversation.id,
        reviewTimestamp: 4,
        runId: run.id,
        targetRun: run,
      }),
    ).toBe(false);
    expect(useChatStore.getState().conversations[0].agentRuns?.[0]).toMatchObject({
      status: 'running',
      controlGraph: { status: 'model_turn' },
    });
  });

  it('does not clear a concurrent non-worker asynchronous operation', () => {
    const run = makeRun();
    run.controlGraph = {
      ...run.controlGraph!,
      pendingAsyncCount: 1,
      asyncWork: {
        awaitingBackgroundWorkers: true,
        pendingOperations: [
          {
            key: 'workflow:deploy-1',
            kind: 'expo-workflow',
            resourceId: 'deploy-1',
            displayName: 'Deploy workflow',
            status: 'running',
            lastUpdatedByTool: 'workflow_status',
            updatedAt: 2,
            monitorToolNames: ['workflow_status'],
          },
        ],
        updatedAt: 2,
      },
    };
    const conversation = {
      id: 'conversation-1',
      title: 'Background completion',
      messages: [
        { id: 'user-1', role: 'user', content: run.goal, timestamp: 1 },
        {
          id: 'final-1',
          role: 'assistant',
          content: 'Worker report.',
          timestamp: 3,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'stop',
          },
        },
      ],
      createdAt: 1,
      updatedAt: 3,
      agentRuns: [run],
    } as Conversation;
    useChatStore.setState({
      conversations: [conversation],
      activeConversationId: conversation.id,
      isLoading: false,
    });

    expect(
      completeTerminalBackgroundReviewRun({
        appendConversationLog: jest.fn(),
        completeAgentRun: useChatStore.getState().completeAgentRun,
        updateAgentRunControlGraph: useChatStore.getState().updateAgentRunControlGraph,
        completion: {
          status: 'completed',
          latestSummary: 'Worker report.',
          checkpointTitle: 'Background workers finished',
          logLevel: 'info',
          logTitle: 'Background workers finished',
        },
        conversationId: conversation.id,
        reviewTimestamp: 4,
        runId: run.id,
        targetRun: run,
      }),
    ).toBe(false);
    expect(
      useChatStore.getState().conversations[0].agentRuns?.[0]?.controlGraph?.asyncWork
        .pendingOperations,
    ).toHaveLength(1);
  });

  it('does not erase an unresolved tool boundary while closing background work', () => {
    const run = makeRun();
    run.controlGraph = {
      ...run.controlGraph!,
      expectedToolCalls: [{ id: 'call-1', name: 'read_file' }],
    };
    const conversation = {
      id: 'conversation-1',
      title: 'Background completion',
      messages: [
        { id: 'user-1', role: 'user', content: run.goal, timestamp: 1 },
        {
          id: 'final-1',
          role: 'assistant',
          content: 'Worker report.',
          timestamp: 3,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'stop',
          },
        },
      ],
      createdAt: 1,
      updatedAt: 3,
      agentRuns: [run],
    } as Conversation;
    useChatStore.setState({
      conversations: [conversation],
      activeConversationId: conversation.id,
      isLoading: false,
    });

    expect(
      completeTerminalBackgroundReviewRun({
        appendConversationLog: jest.fn(),
        completeAgentRun: useChatStore.getState().completeAgentRun,
        updateAgentRunControlGraph: useChatStore.getState().updateAgentRunControlGraph,
        completion: {
          status: 'completed',
          latestSummary: 'Worker report.',
          checkpointTitle: 'Background workers finished',
          logLevel: 'info',
          logTitle: 'Background workers finished',
        },
        conversationId: conversation.id,
        reviewTimestamp: 4,
        runId: run.id,
        targetRun: run,
      }),
    ).toBe(false);
    expect(
      useChatStore.getState().conversations[0].agentRuns?.[0]?.controlGraph?.expectedToolCalls,
    ).toEqual([{ id: 'call-1', name: 'read_file' }]);
  });

  it('keeps background review retryable when completed delivery validation fails', () => {
    const run = makeRun();
    run.controlGraph = {
      ...run.controlGraph!,
      goals: run.controlGraph!.goals?.map((goal) => {
        const conflicted = {
          ...goal,
          userConstraintIntegrity: 'conflict' as const,
          userConstraintDeliveryPending: true as const,
        };
        delete conflicted.userConstraints;
        return conflicted;
      }),
    };
    const conversation = {
      id: 'conversation-1',
      title: 'Background completion',
      messages: [
        { id: 'user-1', role: 'user', content: run.goal, timestamp: 1 },
        {
          id: 'final-1',
          role: 'assistant',
          content: 'Worker report.',
          timestamp: 3,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'stop',
          },
        },
      ],
      createdAt: 1,
      updatedAt: 3,
      agentRuns: [run],
    } as Conversation;
    useChatStore.setState({
      conversations: [conversation],
      activeConversationId: conversation.id,
      isLoading: false,
    });

    expect(
      completeTerminalBackgroundReviewRun({
        appendConversationLog: jest.fn(),
        completeAgentRun: useChatStore.getState().completeAgentRun,
        updateAgentRunControlGraph: useChatStore.getState().updateAgentRunControlGraph,
        completion: {
          status: 'completed',
          latestSummary: 'Worker report.',
          checkpointTitle: 'Background workers finished',
          logLevel: 'info',
          logTitle: 'Background workers finished',
        },
        conversationId: conversation.id,
        reviewTimestamp: 4,
        runId: run.id,
        targetRun: run,
      }),
    ).toBe(false);

    expect(useChatStore.getState().conversations[0].agentRuns?.[0]).toMatchObject({
      status: 'running',
      controlGraph: {
        status: 'waiting_async',
        asyncWork: { awaitingBackgroundWorkers: true },
      },
    });
  });
});
