import {
  findAgentRunDisplayAnchorMessageId,
  isRenderableDisplayMessage,
  isVisibleAssistantMessageForAgentRun,
} from '../../src/screens/chatScreen/displayProjection';
import type { AgentRun } from '../../src/types/agentRun';
import type { Message } from '../../src/types/message';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: 'Answer',
    timestamp: 1,
    ...overrides,
  };
}

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    userMessageId: 'user-1',
    goal: 'Finish the task',
    status: 'running',
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

describe('displayProjection', () => {
  it('suppresses pending-review assistant candidates from the visible transcript', () => {
    expect(
      isRenderableDisplayMessage(
        makeMessage({
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'incomplete',
            finishReason: 'terminal_review_pending',
          },
        }),
      ),
    ).toBe(false);
  });

  it('keeps complete final assistant messages renderable', () => {
    expect(
      isRenderableDisplayMessage(
        makeMessage({
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
          },
        }),
      ),
    ).toBe(true);
  });

  it('suppresses complete final assistant messages while the run is still active', () => {
    expect(
      isVisibleAssistantMessageForAgentRun(
        makeMessage({
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
          },
        }),
        makeRun(),
      ),
    ).toBe(false);
  });

  it('ignores active-run final answers when resolving the display anchor', () => {
    const run = makeRun();
    const messages = [
      makeMessage({
        id: 'assistant-1',
        content: 'Working...',
        assistantMetadata: {
          kind: 'intermediate',
          completionStatus: 'complete',
        },
      }),
      makeMessage({
        id: 'assistant-2',
        content: 'Final answer',
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
        },
      }),
    ];

    expect(findAgentRunDisplayAnchorMessageId(messages, run)).toBe('assistant-1');
  });
});
