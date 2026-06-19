import { reviewForegroundRunCompletion } from '../../../src/engine/graph/foregroundRun/completionReview';
import { useChatStore } from '../../../src/store/useChatStore';
import type { AgentRun } from '../../../src/types/agentRun';
import type { Message } from '../../../src/types/message';

function buildMessage(overrides: Partial<Message>): Message {
  return {
    id: 'msg-default',
    role: 'assistant',
    content: '',
    timestamp: 1,
    ...overrides,
  };
}

function buildRun(): AgentRun {
  return {
    id: 'run-1',
    userMessageId: 'msg-user',
    goal: 'Compare official docs and return a short markdown table.',
    status: 'running',
    createdAt: 10,
    updatedAt: 50,
    currentPhase: 'review',
    phases: [],
    checkpoints: [],
    plan: {
      objective: 'Compare official docs and return a short markdown table.',
      successCriteria: ['Deliver the requested comparison table.'],
      stopConditions: ['Stop once the table is complete.'],
      workstreams: [],
      updatedAt: 10,
    },
    summary: {
      assistantTurns: 2,
      startedTools: 1,
      completedTools: 1,
      failedTools: 0,
      spawnedSubAgents: 0,
    },
    controlGraph: {
      version: 1,
      status: 'finalized',
      iteration: 2,
      expectedToolCalls: [],
      observedToolResults: [],
      pendingAsyncCount: 0,
      lastModelToolNames: [],
      audit: [],
      updatedAt: 50,
    } as any,
  } as AgentRun;
}

describe('foregroundRun completion review', () => {
  beforeEach(() => {
    useChatStore.setState((state) => ({
      ...state,
      conversations: [],
      activeConversationId: null,
      isLoading: false,
    }));
  });

  it('finalizes directly from the visible final assistant answer', async () => {
    const run = buildRun();
    const finalAnswer =
      '| Feature | OpenAI Responses API | Gemini generateContent API |\n| :--- | :--- | :--- |';
    const messages: Message[] = [
      buildMessage({
        id: 'msg-user',
        role: 'user',
        content: 'Compare the official docs and return a short table.',
        timestamp: 10,
      }),
      buildMessage({
        id: 'msg-tool-search',
        role: 'tool',
        content: '{"provider":"gemini","searches":[]}',
        timestamp: 20,
        toolCallId: 'web_search',
      }),
      buildMessage({
        id: 'msg-assistant-final',
        role: 'assistant',
        content: finalAnswer,
        timestamp: 50,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
        },
      }),
    ];

    useChatStore.setState((state) => ({
      ...state,
      conversations: [
        {
          id: 'conversation-1',
          title: 'Docs comparison',
          messages,
          providerId: 'provider-1',
          createdAt: 10,
          updatedAt: 50,
          usage: {
            entries: [],
            totalInput: 0,
            totalOutput: 0,
            totalCacheRead: 0,
            totalCacheWrite: 0,
            totalTokens: 0,
            totalCost: 0,
            totalCalls: 0,
          },
          logs: [],
          agentRuns: [run],
        } as any,
      ],
      activeConversationId: 'conversation-1',
    }));

    const result = await reviewForegroundRunCompletion({
      appendConversationLog: jest.fn(),
      assertNotAborted: jest.fn(),
      conversationId: 'conversation-1',
      finalizeTrackedRun: jest.fn(),
      recoverAgentRunFinalPreview: jest.fn(async () => ({ recovered: false })),
      resumeAgentRun: null,
      runId: 'run-1',
      signal: new AbortController().signal,
      turnSummary: finalAnswer,
      updateAgentRunControlGraph: jest.fn(),
      updateAgentRunSummary: jest.fn(),
      setAgentRunPhase: jest.fn(),
    });

    expect(result).toEqual(
      expect.objectContaining({
        handled: false,
        completionStatus: 'completed',
        latestSummary: finalAnswer,
        checkpointTitle: 'Final response delivered',
      }),
    );
  });
});
