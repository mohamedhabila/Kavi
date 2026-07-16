import { resolvePreferredAgentRunFinalResponseMessageId } from '../../src/screens/agentRunFinalResponseSelection';
import { tryDeliverPreferredFinalResponse } from '../../src/screens/agentRunPreferredFinalResponse';
import type { AgentRun } from '../../src/types/agentRun';
import type { Message } from '../../src/types/message';

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    userMessageId: 'user-1',
    goal: 'Finish the task',
    status: 'completed',
    createdAt: 1,
    updatedAt: 2,
    currentPhase: 'review',
    phases: [],
    checkpoints: [],
    summary: {
      assistantTurns: 1,
      startedTools: 0,
      completedTools: 0,
      failedTools: 0,
      spawnedSubAgents: 0,
    },
    ...overrides,
  };
}

function makeMessage(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    role: 'assistant',
    content: 'Answer',
    timestamp: 1,
    ...overrides,
  };
}

describe('resolvePreferredAgentRunFinalResponseMessageId', () => {
  it('falls back to the latest visible assistant candidate when no explicit id is supplied', () => {
    const run = makeRun();
    const messages = [
      makeMessage('user-1', { role: 'user', content: 'Research this' }),
      makeMessage('assistant-1', {
        content: 'Draft answer',
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'incomplete',
          finishReason: 'terminal_review_pending',
        },
      }),
    ];

    expect(
      resolvePreferredAgentRunFinalResponseMessageId({
        messages,
        run,
      }),
    ).toBe('assistant-1');
  });

  it('keeps an explicit preferred message id only when it is the latest owning projection', () => {
    const messages = [
      makeMessage('user-1', { role: 'user', content: 'Research this' }),
      makeMessage('assistant-current', {
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'stop',
        },
      }),
    ];
    expect(
      resolvePreferredAgentRunFinalResponseMessageId({
        messages,
        preferredAssistantMessageId: 'assistant-current',
        run: makeRun(),
      }),
    ).toBe('assistant-current');
  });

  it('rejects an older final when a newer empty tool projection owns the run boundary', () => {
    const run = makeRun({
      controlGraph: {
        version: 1,
        status: 'awaiting_review',
        iteration: 2,
        expectedToolCalls: [],
        observedToolResults: [],
        pendingAsyncCount: 0,
        lastModelToolNames: [],
        audit: [],
        updatedAt: 3,
        goals: [
          {
            id: 'constrained',
            title: 'Constrained result',
            status: 'completed',
            completionPolicy: 'blocking',
            dependencies: [],
            evidence: ['read_file:ok'],
            successCriteria: ['evidence.tool:read_file'],
            userConstraints: [{ text: 'Reply in Dutch.', sourceMessageId: 'user-1' }],
            userConstraintDeliveryPending: true,
            createdAt: 1,
            updatedAt: 2,
            completedAt: 2,
          },
        ],
      },
    });
    const messages = [
      makeMessage('user-1', { role: 'user', content: 'Reply in Dutch.' }),
      makeMessage('assistant-old', {
        content: 'Old answer',
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'stop',
        },
      }),
      makeMessage('assistant-tool', {
        content: '',
        assistantMetadata: {
          kind: 'intermediate',
          completionStatus: 'complete',
          finishReason: 'tool_calls',
        },
        toolCalls: [
          { id: 'call-1', name: 'update_goals', arguments: '{}', status: 'completed' },
        ],
      }),
    ];

    expect(
      resolvePreferredAgentRunFinalResponseMessageId({
        messages,
        preferredAssistantMessageId: 'assistant-old',
        run,
      }),
    ).toBeUndefined();
    expect(resolvePreferredAgentRunFinalResponseMessageId({ messages, run })).toBeUndefined();

    const updateMessageAssistantMetadata = jest.fn();
    expect(
      tryDeliverPreferredFinalResponse({
        assertNotAborted: jest.fn(),
        conversation: { id: 'conversation-1', messages, agentRuns: [run] } as never,
        conversationId: 'conversation-1',
        preferredAssistantMessageId: 'assistant-old',
        run,
        runId: run.id,
        status: 'completed',
        effects: {
          appendAgentRunCheckpoint: jest.fn(),
          appendConversationLog: jest.fn(),
          updateAgentRunSummary: jest.fn(),
          updateMessageAssistantMetadata,
        },
      }),
    ).toBeUndefined();
    expect(updateMessageAssistantMetadata).not.toHaveBeenCalled();
  });
});
