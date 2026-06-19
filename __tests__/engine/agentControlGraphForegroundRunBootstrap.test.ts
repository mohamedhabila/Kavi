import {
  buildForegroundRunBootstrapSelection,
  startOrReuseForegroundTrackedRun,
} from '../../src/engine/graph/foregroundRun/bootstrap';
import type { AgentRun } from '../../src/types/agentRun';
import type { Conversation } from '../../src/types/conversation';
import type { Message } from '../../src/types/message';

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
    providerId: 'openai',
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
      assistantTurns: 1,
      startedTools: 2,
      completedTools: 1,
      failedTools: 0,
      spawnedSubAgents: 0,
    },
    ...overrides,
  };
}

describe('foregroundRun bootstrap', () => {
  it('reuses a visible incomplete assistant draft when resuming an existing run', () => {
    const conversation = createConversation({
      activeAgentRunId: 'run-1',
      agentRuns: [createRunningAgentRun()],
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Finish the task',
          timestamp: 1,
        } as Message,
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Draft answer.',
          timestamp: 2,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'incomplete',
          },
        } as Message,
      ],
    });
    const createAssistantMessageId = jest.fn(() => 'assistant-new');

    const result = buildForegroundRunBootstrapSelection({
      conversation,
      createAssistantMessageId,
      reuseAgentRunId: 'run-1',
    });

    expect(result.shouldAbortPreviousForegroundRequest).toBe(false);
    expect(result.shouldTrackAgentRun).toBe(true);
    expect(result.existingRun?.id).toBe('run-1');
    expect(result.resumedAssistantDraft?.id).toBe('assistant-1');
    expect(result.assistantMessageId).toBe('assistant-1');
    expect(result.shouldInsertPlaceholderAssistant).toBe(false);
    expect(result.supersededRun).toBeUndefined();
    expect(createAssistantMessageId).not.toHaveBeenCalled();
  });

  it('does not reuse a completed visible final assistant message as a resumed draft', () => {
    const conversation = createConversation({
      activeAgentRunId: 'run-1',
      agentRuns: [createRunningAgentRun()],
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Finish the task',
          timestamp: 1,
        } as Message,
        {
          id: 'assistant-final',
          role: 'assistant',
          content: 'Final answer already delivered.',
          timestamp: 2,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
          },
        } as Message,
      ],
    });
    const createAssistantMessageId = jest.fn(() => 'assistant-new');

    const result = buildForegroundRunBootstrapSelection({
      conversation,
      createAssistantMessageId,
      reuseAgentRunId: 'run-1',
    });

    expect(result.resumedAssistantDraft).toBeUndefined();
    expect(result.assistantMessageId).toBe('assistant-new');
    expect(result.shouldInsertPlaceholderAssistant).toBe(true);
    expect(createAssistantMessageId).toHaveBeenCalledTimes(1);
  });

  it('selects the active run as superseded and seeds a fresh assistant turn for a new request', () => {
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

    const result = buildForegroundRunBootstrapSelection({
      conversation,
      createAssistantMessageId: () => 'assistant-new',
    });

    expect(result.shouldAbortPreviousForegroundRequest).toBe(true);
    expect(result.shouldTrackAgentRun).toBe(true);
    expect(result.supersededRun?.id).toBe('run-1');
    expect(result.supersededRunningWorkerCount).toBe(0);
    expect(result.assistantMessageId).toBe('assistant-new');
    expect(result.shouldInsertPlaceholderAssistant).toBe(true);
    expect(result.latestUserMessage?.id).toBe('user-2');
  });

  it('starts a new tracked run or reuses the existing one through graph-owned bootstrap helpers', () => {
    const clearTrackedRunCancellation = jest.fn();
    const startAgentRun = jest.fn(() => 'run-2');

    const startedRunId = startOrReuseForegroundTrackedRun({
      bootstrap: {
        shouldTrackAgentRun: true,
        latestUserMessage: {
          id: 'user-1',
          role: 'user',
          content: 'Finish the task  ',
          timestamp: 1,
        } as Message,
      },
      clearTrackedRunCancellation,
      conversationId: 'conv1',
      createUserMessageId: () => 'generated-user-id',
      startAgentRun,
    });

    expect(startedRunId).toBe('run-2');
    expect(startAgentRun).toHaveBeenCalledWith('conv1', {
      userMessageId: 'user-1',
      goal: 'Finish the task',
      summary: {
        assistantTurns: 1,
      },
    });
    expect(clearTrackedRunCancellation).toHaveBeenCalledWith('conv1', 'run-2');

    clearTrackedRunCancellation.mockClear();
    startAgentRun.mockClear();

    const reusedRunId = startOrReuseForegroundTrackedRun({
      bootstrap: {
        shouldTrackAgentRun: true,
        existingRun: createRunningAgentRun({ id: 'run-existing' }),
      },
      clearTrackedRunCancellation,
      conversationId: 'conv1',
      createUserMessageId: () => 'generated-user-id',
      startAgentRun,
    });

    expect(reusedRunId).toBe('run-existing');
    expect(startAgentRun).not.toHaveBeenCalled();
    expect(clearTrackedRunCancellation).toHaveBeenCalledWith('conv1', 'run-existing');
  });
});
