import { resolvePreferredAgentRunFinalResponseMessageId } from '../../src/screens/agentRunFinalResponseSelection';
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

  it('keeps an explicit preferred message id when provided', () => {
    expect(
      resolvePreferredAgentRunFinalResponseMessageId({
        messages: [makeMessage('assistant-1')],
        preferredAssistantMessageId: 'assistant-explicit',
        run: makeRun(),
      }),
    ).toBe('assistant-explicit');
  });
});
