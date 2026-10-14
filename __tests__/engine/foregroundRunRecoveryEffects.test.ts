import { renderHook } from '@testing-library/react-native';
import { useForegroundRunRecoveryEffects } from '../../src/engine/graph/foregroundRun/useForegroundRunRecoveryEffects';
import type { Conversation } from '../../src/types/conversation';
import { makeTestAgentRun } from '../helpers/factories';

function conversationWithFailedRun(): Conversation {
  return {
    id: 'conversation-1',
    title: 'Thread',
    createdAt: 1,
    updatedAt: 2,
    messages: [
      { id: 'user-1', role: 'user', content: 'Plan the trip.', timestamp: 1 },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Day one: Lis',
        timestamp: 2,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'incomplete',
          finishReason: 'response_failed',
        },
      },
    ],
    agentRuns: [makeTestAgentRun({ id: 'run-1', userMessageId: 'user-1', status: 'failed' })],
  } as Conversation;
}

describe('foreground run recovery effects', () => {
  // A terminal run without an answer used to get one written in the background: a model call
  // synthesizing it from the run's tool results, or "The run failed before it generated a
  // final response." Only the agent loop writes answers now.
  it('writes no answer for a terminal run that ended without one', () => {
    const conversation = conversationWithFailedRun();
    const before = JSON.stringify(conversation);
    const queueTerminalBackgroundReview = jest.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useForegroundRunRecoveryEffects({
        conversations: [conversation],
        queueTerminalBackgroundReview,
        subAgentActivityVersion: 0,
      }),
    );

    expect(queueTerminalBackgroundReview).not.toHaveBeenCalled();
    expect(JSON.stringify(conversation)).toBe(before);
  });
});
