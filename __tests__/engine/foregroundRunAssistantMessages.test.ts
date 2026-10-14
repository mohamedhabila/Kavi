import type { Message } from '../../src/types/message';
import {
  findLatestAgentRunAssistantMessageId,
  findLatestIncompleteAgentRunAssistantMessage,
} from '../../src/engine/graph/foregroundRun/assistantMessages';

describe('foreground run assistant message lookup', () => {
  it('does not reuse an older final after a newer empty owning tool projection', () => {
    const messages: Message[] = [
      {
        id: 'compact-1',
        role: 'system',
        content: '[Conversation Summary] Earlier turns were compacted.',
        timestamp: 10,
      },
      {
        id: 'final-answer',
        role: 'assistant',
        content: 'C653A C653B C653P C653W',
        timestamp: 100,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'STOP',
        },
      },
      {
        id: 'recovery-note',
        role: 'system',
        content: 'Deliver the final answer now.',
        timestamp: 110,
      },
      {
        id: 'empty-placeholder',
        role: 'assistant',
        content: '',
        timestamp: 120,
        toolCalls: [
          {
            id: 'call-1',
            name: 'update_goals',
            arguments: '{}',
            status: 'completed',
          },
        ],
      },
    ];

    const runScope = {
      userMessageId: 'compacted-user',
      runStartedAt: 90,
    };

    expect(findLatestAgentRunAssistantMessageId(messages, runScope)).toBeUndefined();
  });

  it('does not reuse an incomplete draft after a newer empty owning projection', () => {
    const messages: Message[] = [
      {
        id: 'compact-1',
        role: 'system',
        content: '[Conversation Summary] Earlier turns were compacted.',
        timestamp: 10,
      },
      {
        id: 'draft-answer',
        role: 'assistant',
        content: 'Partial visible draft',
        timestamp: 100,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'incomplete',
          finishReason: 'response_failed',
        },
      },
      {
        id: 'empty-placeholder',
        role: 'assistant',
        content: '',
        timestamp: 110,
      },
    ];

    const runScope = {
      userMessageId: 'compacted-user',
      runStartedAt: 90,
    };

    expect(findLatestIncompleteAgentRunAssistantMessage(messages, runScope)).toBeUndefined();
  });
});
