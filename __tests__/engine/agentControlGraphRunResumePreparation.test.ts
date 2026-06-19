import { prepareAgentRunResumeForOrchestrator } from '../../src/engine/graph/runResumePreparation';
import { createInitialAgentRunControlGraphState } from '../../src/services/agents/agentControlGraphState';
import type { AgentRun } from '../../src/types/agentRun';
import type { Message } from '../../src/types/message';

function userMessage(id: string): Message {
  return {
    id,
    role: 'user',
    content: id,
    timestamp: 1,
  };
}

function resumableRun(): Pick<AgentRun, 'controlGraph' | 'userMessageId'> {
  return {
    userMessageId: 'user-original',
    controlGraph: createInitialAgentRunControlGraphState({
      status: 'finalized',
      iteration: 3,
      terminalReason: 'completed',
      updatedAt: 1,
    }),
  };
}

describe('agent control graph run resume preparation', () => {
  it('resolves workflow scope without a resumable run', () => {
    const result = prepareAgentRunResumeForOrchestrator({
      fallbackUserMessageId: 'user-1',
      messages: [userMessage('user-1'), userMessage('user-2')],
      updatedAt: 100,
    });

    expect(result.workflowScopeUserMessageId).toBe('user-1');
    expect(result.initialAgentControlGraphState).toBeUndefined();
  });

  it('falls back to the latest scoped user message when the run owner is absent', () => {
    const result = prepareAgentRunResumeForOrchestrator({
      existingRun: resumableRun(),
      fallbackUserMessageId: 'missing-user',
      messages: [userMessage('user-visible-1'), userMessage('user-visible-2')],
      updatedAt: 100,
    });

    expect(result.workflowScopeUserMessageId).toBe('user-visible-2');
  });

  it('preserves interrupted graph-owned state for waiting_async resume', () => {
    const result = prepareAgentRunResumeForOrchestrator({
      existingRun: {
        userMessageId: 'user-original',
        controlGraph: createInitialAgentRunControlGraphState({
          status: 'waiting_async',
          iteration: 4,
          activeTaskId: 'goal-1',
          goals: [
            {
              id: 'goal-1',
              title: 'Collect sources',
              status: 'active',
              dependencies: [],
              evidence: ['worker:earlier'],
              createdAt: 1,
              updatedAt: 2,
            },
          ],
          asyncWork: {
            awaitingBackgroundWorkers: true,
            pendingOperations: [
              {
                key: 'session:sub-1',
                kind: 'session',
                resourceId: 'sub-1',
                displayName: 'Session sub-1',
                status: 'running',
                blocksFinalization: false,
                lastUpdatedByTool: 'sessions_spawn',
                updatedAt: 50,
                monitorToolNames: ['sessions_wait'],
              },
            ],
            updatedAt: 50,
          },
          turnDirectives: {
            forceFinalText: false,
            requireWorkflowTool: false,
            incompleteFinalTextRecoveryCount: 1,
          },
          updatedAt: 50,
        }),
      },
      messages: [userMessage('user-original')],
      updatedAt: 100,
    });

    expect(result.initialAgentControlGraphState).toEqual(
      expect.objectContaining({
        status: 'waiting_async',
        activeTaskId: 'goal-1',
        goals: [
          expect.objectContaining({
            id: 'goal-1',
            evidence: ['worker:earlier'],
          }),
        ],
        asyncWork: expect.objectContaining({
          awaitingBackgroundWorkers: true,
          pendingOperations: [
            expect.objectContaining({
              resourceId: 'sub-1',
            }),
          ],
        }),
        turnDirectives: expect.objectContaining({
          incompleteFinalTextRecoveryCount: 1,
        }),
      }),
    );
  });

  it('prepares a terminal graph for resume without pilot correction reopening', () => {
    const result = prepareAgentRunResumeForOrchestrator({
      existingRun: resumableRun(),
      messages: [userMessage('user-original')],
      updatedAt: 100,
    });

    expect(result.workflowScopeUserMessageId).toBe('user-original');
    expect(result.initialAgentControlGraphState).toEqual(
      expect.objectContaining({
        status: 'ready',
        terminalReason: undefined,
      }),
    );
    expect(result.initialAgentControlGraphState?.audit.map((event) => event.type)).toEqual(
      expect.arrayContaining(['RUN_RESUMED_FROM_TERMINAL_GRAPH']),
    );
  });
});
