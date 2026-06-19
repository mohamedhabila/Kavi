import { synthesizeAgentRunCompletion } from '../../src/screens/agentRunCompletionSynthesis';
import { synthesizeAgentRunFinalAnswer } from '../../src/services/agents/lifecycle/finalizePhase';
import { useChatStore } from '../../src/store/useChatStore';
import type { AgentRun } from '../../src/types/agentRun';
import type { Message } from '../../src/types/message';

jest.mock('../../src/services/agents/lifecycle/finalizePhase', () => {
  const actual = jest.requireActual('../../src/services/agents/lifecycle/finalizePhase');
  return {
    ...actual,
    synthesizeAgentRunFinalAnswer: jest.fn(),
  };
});

function buildRun(): AgentRun {
  return {
    id: 'run-1',
    userMessageId: 'msg-user',
    goal: 'Create c996a.txt and c996b.txt, verify them, run python, start a worker, and answer exactly.',
    status: 'completed',
    createdAt: 10,
    updatedAt: 60,
    currentPhase: 'deliver',
    phases: [],
    checkpoints: [],
    plan: {
      objective:
        'Create c996a.txt and c996b.txt, verify them, run python, start a worker, and answer exactly.',
      successCriteria: ['Deliver the exact verified final response.'],
      stopConditions: ['Stop once the exact final response is visible.'],
      workstreams: [],
      updatedAt: 10,
    },
    summary: {
      assistantTurns: 5,
      startedTools: 5,
      completedTools: 5,
      failedTools: 0,
      spawnedSubAgents: 1,
    },
    controlGraph: {
      version: 1,
      status: 'finalized',
      iteration: 5,
      expectedToolCalls: [],
      observedToolResults: [],
      pendingAsyncCount: 0,
      lastModelToolNames: [],
      goals: [
        {
          id: 'synthesize-final',
          title: 'Synthesize final response',
          status: 'completed',
          dependencies: [],
          evidence: ['C996A C996B C996P C996W'],
          createdAt: 10,
          updatedAt: 60,
          completedAt: 60,
        },
      ],
      asyncWork: {
        awaitingBackgroundWorkers: false,
        pendingOperations: [],
        updatedAt: 60,
      },
      performance: {
        modelTurnCount: 0,
        modelDurationMs: 0,
        toolExecutionCount: 0,
        toolExecutionDurationMs: 0,
        lastCandidateToolCount: 0,
        lastActiveToolCount: 0,
        maxActiveToolCount: 0,
        lastActiveToolTokenEstimate: 0,
        maxActiveToolTokenEstimate: 0,
        updatedAt: 60,
      },
      turnDirectives: {
        forceFinalText: false,
        requireWorkflowTool: false,
        incompleteFinalTextRecoveryCount: 0,
      },
      audit: [],
      updatedAt: 60,
    },
  } as AgentRun;
}

function buildMessage(overrides: Partial<Message>): Message {
  return {
    id: 'msg-default',
    role: 'assistant',
    content: '',
    timestamp: 1,
    ...overrides,
  };
}

describe('agentRunCompletionSynthesis', () => {
  beforeEach(() => {
    jest.mocked(synthesizeAgentRunFinalAnswer).mockReset();
    useChatStore.setState((state) => ({
      ...state,
      conversations: [],
      activeConversationId: null,
      isLoading: false,
    }));
  });

  it('uses the graph-owned exact final output before generic fallback synthesis', async () => {
    const run = buildRun();
    const messages: Message[] = [
      buildMessage({
        id: 'msg-user',
        role: 'user',
        content:
          'Create c996a.txt with C996A and c996b.txt with C996B read both back run python print C996P start background worker answer C996W wait final exactly C996A C996B C996P C996W no remote tools',
        timestamp: 10,
      }),
      buildMessage({
        id: 'msg-tool-read',
        role: 'tool',
        content: 'C996B',
        timestamp: 20,
        toolCallId: 'read_file',
      }),
      buildMessage({
        id: 'msg-tool-python',
        role: 'tool',
        content:
          '{"summary":"Python execution completed and recorded 1 verification metadata entry.","status":"completed","output":"C996P","verificationMetadataCount":1}',
        timestamp: 30,
        toolCallId: 'python',
      }),
      buildMessage({
        id: 'msg-tool-worker',
        role: 'tool',
        content:
          '{"sessionId":"sub-1","status":"completed","hasOutput":true,"output":"C996W","outputChars":5}',
        timestamp: 40,
        toolCallId: 'sessions_wait',
      }),
      buildMessage({
        id: 'msg-assistant-empty',
        role: 'assistant',
        content: '',
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
          title: 'C996 synthesis',
          messages,
          providerId: 'provider-1',
          createdAt: 10,
          updatedAt: 60,
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

    const completion = await synthesizeAgentRunCompletion({
      conversationId: 'conversation-1',
      run,
      status: 'completed',
      signal: new AbortController().signal,
    });

    expect(completion).toEqual({
      output: 'C996A C996B C996P C996W',
      source: 'graph',
    });
    expect(synthesizeAgentRunFinalAnswer).not.toHaveBeenCalled();
  });
});
