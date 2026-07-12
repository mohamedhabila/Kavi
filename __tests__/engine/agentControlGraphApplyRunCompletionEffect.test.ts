import { applyConversationRunCompletionEffect } from '../../src/engine/graph/applyRunCompletionEffect';
import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import type { Conversation } from '../../src/types/conversation';
import { createGoal } from '../../src/engine/goals/types';

describe('applyConversationRunCompletionEffect', () => {
  it('marks the control graph terminal before completing the run', () => {
    const updateAgentRunControlGraph = jest.fn();
    const completeAgentRun = jest.fn();
    const conversation: Conversation = {
      id: 'conv1',
      title: 'Test',
      messages: [],
      providerId: 'openai',
      createdAt: 1,
      updatedAt: 1,
      usage: {
        entries: [],
        totalInput: 0,
        totalOutput: 0,
        totalCost: 0,
      },
      agentRuns: [
        {
          id: 'run-1',
          userMessageId: 'msg-1',
          goal: 'Finish the task',
          status: 'running',
          createdAt: 1,
          updatedAt: 1,
          currentPhase: 'work',
          phases: [],
          checkpoints: [],
          controlGraph: createInitialAgentControlGraphSnapshot(),
          summary: {
            assistantTurns: 0,
            startedTools: 0,
            completedTools: 0,
            failedTools: 0,
            spawnedSubAgents: 0,
          },
        },
      ],
    };

    applyConversationRunCompletionEffect({
      actions: {
        completeAgentRun,
        updateAgentRunControlGraph,
      },
      conversationId: 'conv1',
      effect: {
        status: 'cancelled',
        checkpointTitle: 'Turn cancelled',
        terminalReason: 'user_cancelled',
      },
      getLatestConversation: () => conversation,
      runId: 'run-1',
    });

    expect(updateAgentRunControlGraph).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        status: 'cancelled',
        terminalReason: 'user_cancelled',
      }),
      'run-1',
    );
    expect(completeAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        status: 'cancelled',
        checkpointTitle: 'Turn cancelled',
        terminalReason: 'user_cancelled',
      }),
      'run-1',
    );
  });

  it('does not re-complete a run that is already terminal', () => {
    const updateAgentRunControlGraph = jest.fn();
    const completeAgentRun = jest.fn();
    const conversation: Conversation = {
      id: 'conv1',
      title: 'Test',
      messages: [],
      providerId: 'openai',
      createdAt: 1,
      updatedAt: 1,
      usage: {
        entries: [],
        totalInput: 0,
        totalOutput: 0,
        totalCost: 0,
      },
      agentRuns: [
        {
          id: 'run-1',
          userMessageId: 'msg-1',
          goal: 'Finish the task',
          status: 'completed',
          createdAt: 1,
          updatedAt: 1,
          completedAt: 2,
          currentPhase: 'deliver',
          phases: [],
          checkpoints: [],
          summary: {
            assistantTurns: 1,
            startedTools: 1,
            completedTools: 1,
            failedTools: 0,
            spawnedSubAgents: 0,
          },
        },
      ],
    };

    applyConversationRunCompletionEffect({
      actions: {
        completeAgentRun,
        updateAgentRunControlGraph,
      },
      conversationId: 'conv1',
      effect: {
        status: 'cancelled',
        checkpointTitle: 'Turn cancelled',
      },
      getLatestConversation: () => conversation,
      runId: 'run-1',
    });

    expect(updateAgentRunControlGraph).not.toHaveBeenCalled();
    expect(completeAgentRun).not.toHaveBeenCalled();
  });

  it('returns false without side effects when the target run no longer exists', () => {
    const updateAgentRunControlGraph = jest.fn();
    const completeAgentRun = jest.fn();
    const conversation = {
      id: 'conv1',
      title: 'Test',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      agentRuns: [],
    } as Conversation;

    expect(
      applyConversationRunCompletionEffect({
        actions: { completeAgentRun, updateAgentRunControlGraph },
        conversationId: conversation.id,
        effect: { status: 'failed' },
        getLatestConversation: () => conversation,
        runId: 'missing-run',
      }),
    ).toBe(false);
    expect(updateAgentRunControlGraph).not.toHaveBeenCalled();
    expect(completeAgentRun).not.toHaveBeenCalled();
  });

  it('does not persist a prepared boundary when completion preparation rejects latest state', () => {
    const updateAgentRunControlGraph = jest.fn();
    const completeAgentRun = jest.fn();
    const conversation = {
      id: 'conv1',
      title: 'Test',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      agentRuns: [
        {
          id: 'run-1',
          userMessageId: 'msg-1',
          goal: 'Finish the task',
          status: 'running',
          createdAt: 1,
          updatedAt: 1,
          currentPhase: 'review',
          phases: [],
          checkpoints: [],
          controlGraph: createInitialAgentControlGraphSnapshot({ status: 'waiting_async' }),
          summary: {
            assistantTurns: 1,
            startedTools: 0,
            completedTools: 0,
            failedTools: 0,
            spawnedSubAgents: 1,
          },
        },
      ],
    } as Conversation;
    const prepareControlGraph = jest.fn().mockReturnValue(undefined);

    expect(
      applyConversationRunCompletionEffect({
        actions: { completeAgentRun, updateAgentRunControlGraph },
        conversationId: conversation.id,
        effect: { status: 'completed' },
        getLatestConversation: () => conversation,
        prepareControlGraph,
        runId: 'run-1',
      }),
    ).toBe(false);
    expect(prepareControlGraph).toHaveBeenCalledWith(
      conversation.agentRuns?.[0].controlGraph,
    );
    expect(updateAgentRunControlGraph).not.toHaveBeenCalled();
    expect(completeAgentRun).not.toHaveBeenCalled();
  });

  describe('persisted final delivery boundary', () => {
    function constrainedConversation(messages: Conversation['messages']): Conversation {
      const constrainedGoal = {
        ...createGoal({
          id: 'done',
          title: 'Completed constrained goal',
          status: 'active',
          completionPolicy: 'blocking',
          successCriteria: ['evidence.tool:read_file'],
          userConstraints: [{ text: 'Reply in Dutch.', sourceMessageId: 'user-1' }],
          now: 1,
        }),
        status: 'completed' as const,
        updatedAt: 2,
        completedAt: 2,
        userConstraintDeliveryPending: true as const,
      };
      const controlGraph = createInitialAgentControlGraphSnapshot({
        status: 'awaiting_review',
        goals: [constrainedGoal],
      });
      return {
        id: 'conv1',
        title: 'Test',
        messages,
        providerId: 'openai',
        createdAt: 1,
        updatedAt: 1,
        agentRuns: [
          {
            id: 'run-1',
            userMessageId: 'msg-1',
            goal: 'Finish the task',
            status: 'running',
            createdAt: 1,
            updatedAt: 1,
            currentPhase: 'deliver',
            phases: [],
            checkpoints: [],
            controlGraph,
            summary: {
              assistantTurns: 1,
              startedTools: 1,
              completedTools: 1,
              failedTools: 0,
              spawnedSubAgents: 0,
            },
          },
        ],
      } as Conversation;
    }

    it('acknowledges only after the latest scoped projection is a settled final', () => {
      const conversation = constrainedConversation([
        { id: 'user-1', role: 'user', content: 'Reply in Dutch.', timestamp: 1 },
        {
          id: 'final-1',
          role: 'assistant',
          content: 'Het resultaat is geverifieerd.',
          timestamp: 3,
          assistantMetadata: { kind: 'final', completionStatus: 'complete' },
        },
      ]);
      const updateAgentRunControlGraph = jest.fn();
      const completeAgentRun = jest.fn();

      expect(applyConversationRunCompletionEffect({
        actions: {
          completeAgentRun,
          updateAgentRunControlGraph,
        },
        conversationId: conversation.id,
        effect: { status: 'completed' },
        getLatestConversation: () => conversation,
        runId: 'run-1',
      })).toBe(true);

      const nextGraph = updateAgentRunControlGraph.mock.calls[0]?.[1];
      expect(nextGraph).toMatchObject({ status: 'finalized' });
      expect(nextGraph?.goals?.[0]).not.toHaveProperty('userConstraintDeliveryPending');
      expect(nextGraph?.goals?.[0]).not.toHaveProperty('userConstraints');
      expect(
        nextGraph?.audit.some((event) => event.type === 'USER_CONSTRAINT_DELIVERY_ACKNOWLEDGED'),
      ).toBe(true);
      expect(completeAgentRun).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['missing', []],
      [
        'superseded',
        [
          { id: 'user-1', role: 'user', content: 'Reply in Dutch.', timestamp: 1 },
          {
            id: 'old-final',
            role: 'assistant',
            content: 'Oud antwoord.',
            timestamp: 2,
            assistantMetadata: { kind: 'final', completionStatus: 'complete' },
          },
          {
            id: 'new-incomplete',
            role: 'assistant',
            content: 'Nieuw antwoord is nog niet af',
            timestamp: 3,
            assistantMetadata: { kind: 'final', completionStatus: 'incomplete' },
          },
        ],
      ],
      [
        'wrong-scope',
        [
          { id: 'user-1', role: 'user', content: 'Reply in Dutch.', timestamp: 1 },
          { id: 'user-2', role: 'user', content: 'Different request', timestamp: 2 },
          {
            id: 'other-final',
            role: 'assistant',
            content: 'Other answer.',
            timestamp: 3,
            assistantMetadata: { kind: 'final', completionStatus: 'complete' },
          },
        ],
      ],
    ] as const)('holds completed state when final proof is %s', (_label, messages) => {
      const conversation = constrainedConversation(messages as Conversation['messages']);
      const updateAgentRunControlGraph = jest.fn();
      const completeAgentRun = jest.fn();

      expect(
        applyConversationRunCompletionEffect({
          actions: { completeAgentRun, updateAgentRunControlGraph },
          conversationId: conversation.id,
          effect: { status: 'completed' },
          getLatestConversation: () => conversation,
          runId: 'run-1',
        }),
      ).toBe(false);
      expect(updateAgentRunControlGraph).not.toHaveBeenCalled();
      expect(completeAgentRun).not.toHaveBeenCalled();
    });

    it('may fail a run without acknowledging an undelivered constraint', () => {
      const conversation = constrainedConversation([]);
      const updateAgentRunControlGraph = jest.fn();

      expect(
        applyConversationRunCompletionEffect({
          actions: { completeAgentRun: jest.fn(), updateAgentRunControlGraph },
          conversationId: conversation.id,
          effect: { status: 'failed' },
          getLatestConversation: () => conversation,
          runId: 'run-1',
        }),
      ).toBe(true);
      const nextGraph = updateAgentRunControlGraph.mock.calls[0]?.[1];
      expect(nextGraph).toMatchObject({ status: 'failed' });
      expect(nextGraph?.goals?.[0]?.userConstraintDeliveryPending).toBe(true);
      expect(nextGraph?.goals?.[0]?.userConstraints).toHaveLength(1);
    });

    it('rejects completed effects when the run has no control graph', () => {
      const conversation = constrainedConversation([
        { id: 'user-1', role: 'user', content: 'Reply in Dutch.', timestamp: 1 },
        {
          id: 'final-1',
          role: 'assistant',
          content: 'Het resultaat is geverifieerd.',
          timestamp: 3,
          assistantMetadata: { kind: 'final', completionStatus: 'complete' },
        },
      ]);
      delete conversation.agentRuns?.[0]?.controlGraph;
      const updateAgentRunControlGraph = jest.fn();
      const completeAgentRun = jest.fn();

      expect(
        applyConversationRunCompletionEffect({
          actions: { completeAgentRun, updateAgentRunControlGraph },
          conversationId: conversation.id,
          effect: { status: 'completed' },
          getLatestConversation: () => conversation,
          runId: 'run-1',
        }),
      ).toBe(false);
      expect(updateAgentRunControlGraph).not.toHaveBeenCalled();
      expect(completeAgentRun).not.toHaveBeenCalled();
    });
  });
});
