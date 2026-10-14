import { reconcileCompletedAgentRunGraphs } from '../../src/services/agents/agentRunRepair';
import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import { useChatStore } from '../../src/store/useChatStore';
import type { AgentRun } from '../../src/types/agentRun';
import type { Message } from '../../src/types/message';

jest.mock('../../src/store/chatStorePersistence', () => ({
  ...jest.requireActual('../../src/store/chatStorePersistence'),
  flushChatStorePersistenceNow: jest.fn().mockResolvedValue(undefined),
}));

function run(id: string, status: AgentRun['status'], userMessageId: string): AgentRun {
  return {
    id,
    userMessageId,
    goal: 'Answer',
    status,
    createdAt: 10,
    updatedAt: 20,
    currentPhase: 'deliver',
    phases: [],
    checkpoints: [],
    summary: {
      assistantTurns: 1,
      startedTools: 0,
      completedTools: 0,
      failedTools: 0,
      spawnedSubAgents: 0,
    },
    controlGraph: createInitialAgentControlGraphSnapshot({ status: 'awaiting_review' }),
  } as AgentRun;
}

function seed(messages: Message[], agentRuns: AgentRun[]): void {
  useChatStore.setState({
    conversations: [
      { id: 'c1', title: 'Thread', messages, createdAt: 1, updatedAt: 20, agentRuns } as never,
    ],
    activeConversationId: 'c1',
  });
}

function storedRun(id: string): AgentRun | undefined {
  return useChatStore
    .getState()
    .conversations[0]?.agentRuns?.find((candidate) => candidate.id === id);
}

describe('reconcileCompletedAgentRunGraphs', () => {
  it('settles the graph of a completed run whose final answer was persisted', async () => {
    seed(
      [
        { id: 'u1', role: 'user', content: 'Hi', timestamp: 10 },
        {
          id: 'a1',
          role: 'assistant',
          content: 'Hello.',
          timestamp: 11,
          assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
        },
      ],
      [run('r1', 'completed', 'u1')],
    );

    await expect(reconcileCompletedAgentRunGraphs()).resolves.toEqual(['r1']);
    expect(storedRun('r1')?.controlGraph?.status).toBe('finalized');
  });

  // The startup sweep used to write a synthesized or fallback answer ("The run failed before
  // it generated a final response.") into every terminal run without one.
  it('leaves a run that ended without an answer as it ended', async () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'Hi', timestamp: 10 },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Half an ans',
        timestamp: 11,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'incomplete',
          finishReason: 'response_failed',
        },
      },
    ];
    seed(messages, [run('r1', 'failed', 'u1')]);

    await expect(reconcileCompletedAgentRunGraphs()).resolves.toEqual([]);
    expect(useChatStore.getState().conversations[0]?.messages).toEqual(messages);
  });
});
