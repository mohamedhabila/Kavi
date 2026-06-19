import { prepareForegroundRunRequestBootstrap } from '../../src/engine/graph/foregroundRun/requestBootstrap';
import type { AgentRun } from '../../src/types/agentRun';
import type { Conversation } from '../../src/types/conversation';
import type { Message } from '../../src/types/message';

function createRunningAgentRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    userMessageId: 'user-1',
    goal: 'Finish the task',
    status: 'running',
    createdAt: 10,
    updatedAt: 10,
    currentPhase: 'work',
    phases: [],
    checkpoints: [],
    summary: {
      assistantTurns: 2,
      startedTools: 3,
      completedTools: 2,
      failedTools: 1,
      spawnedSubAgents: 1,
    },
    ...overrides,
  };
}

function createConversation(params: {
  activeAgentRunId?: string;
  agentRuns?: AgentRun[];
  messages?: Message[];
}): Conversation {
  return {
    id: 'conv1',
    title: 'Test',
    mode: 'agentic',
    messages: params.messages ?? [],
    providerId: 'provider-1',
    createdAt: 1,
    updatedAt: 1,
    activeAgentRunId: params.activeAgentRunId,
    usage: {
      entries: [],
      totalInput: 0,
      totalOutput: 0,
      totalCost: 0,
    },
    agentRuns: params.agentRuns ?? [],
  };
}

describe('foreground run request bootstrap', () => {
  it('applies supersession, request registration, and counter seeding for a new request', () => {
    const conversation = createConversation({
      activeAgentRunId: 'run-1',
      agentRuns: [createRunningAgentRun()],
      messages: [
        {
          id: 'user-2',
          role: 'user',
          content: 'Start the replacement task',
          timestamp: 1,
        } as Message,
      ],
    });

    const registerForegroundRequest = jest.fn();
    const shouldAutoAbortPreviousForegroundRequest = jest.fn();
    const startTrackedRun = jest.fn(() => 'run-2');
    const supersedeExistingRun = jest.fn();

    const result = prepareForegroundRunRequestBootstrap({
      conversation,
      conversationId: 'conv1',
      createAssistantMessageId: () => 'assistant-new',
      createForegroundRequestId: () => 'request-1',
      defaultConversationMode: 'agentic',
      registerForegroundRequest,
      shouldAutoAbortPreviousForegroundRequest,
      startTrackedRun,
      supersedeExistingRun,
    });

    expect(shouldAutoAbortPreviousForegroundRequest).toHaveBeenCalledWith(
      'Superseded by a new user turn.',
    );
    expect(supersedeExistingRun).toHaveBeenCalledWith('run-1', 0);
    expect(registerForegroundRequest).toHaveBeenCalledWith(
      'request-1',
      expect.any(AbortController),
    );
    expect(startTrackedRun).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMessageId: 'assistant-new',
        shouldInsertPlaceholderAssistant: true,
        supersededRun: expect.objectContaining({ id: 'run-1' }),
      }),
    );
    expect(result.foregroundRequestId).toBe('request-1');
    expect(result.trackedAgentRunId).toBe('run-2');
    expect(result.initialCounters).toEqual({
      assistantTurns: 1,
      startedTools: 0,
      completedTools: 0,
      failedTools: 0,
      spawnedSubAgents: 0,
      runStartedAt: expect.any(Number),
    });
  });

  it('reuses an existing run without auto-aborting the foreground request', () => {
    const conversation = createConversation({
      activeAgentRunId: 'run-1',
      agentRuns: [createRunningAgentRun()],
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Continue the task',
          timestamp: 1,
        } as Message,
      ],
    });

    const shouldAutoAbortPreviousForegroundRequest = jest.fn();

    const result = prepareForegroundRunRequestBootstrap({
      conversation,
      conversationId: 'conv1',
      createAssistantMessageId: () => 'assistant-new',
      createForegroundRequestId: () => 'request-2',
      defaultConversationMode: 'agentic',
      options: { reuseAgentRunId: 'run-1', reuseAssistantDraft: true },
      registerForegroundRequest: jest.fn(),
      shouldAutoAbortPreviousForegroundRequest,
      startTrackedRun: jest.fn(() => 'run-1'),
      supersedeExistingRun: jest.fn(),
    });

    expect(shouldAutoAbortPreviousForegroundRequest).not.toHaveBeenCalled();
    expect(result.bootstrap.existingRun?.id).toBe('run-1');
  });
});
