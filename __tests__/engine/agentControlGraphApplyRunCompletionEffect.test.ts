import { applyConversationRunCompletionEffect } from '../../src/engine/graph/applyRunCompletionEffect';
import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import type { Conversation } from '../../src/types/conversation';

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
});
