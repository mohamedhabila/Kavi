import type { Message } from '../../src/types/message';
import {
  findLatestAgentRunAssistantMessageId,
  findAgentRunReplaceableAssistantMessageId,
  findLatestIncompleteAgentRunAssistantMessage,
  findLatestPreferredAgentRunAssistantMessageId,
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
    expect(findLatestPreferredAgentRunAssistantMessageId(messages, runScope)).toBeUndefined();
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
          finishReason: 'terminal_review_pending',
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

  it.each(['response_failed', 'content_filter'])(
    'does not promote a latest incomplete %s draft to a final response',
    (finishReason) => {
      const messages: Message[] = [
        { id: 'user-1', role: 'user', content: 'Finish this', timestamp: 1 },
        {
          id: 'partial',
          role: 'assistant',
          content: 'Truncated partial output',
          timestamp: 2,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'incomplete',
            finishReason,
          },
        },
      ];

      expect(findLatestPreferredAgentRunAssistantMessageId(messages, 'user-1')).toBeUndefined();
    },
  );

  it('does not overwrite a tool-call projection with synthesized final text', () => {
    const messages: Message[] = [
      { id: 'user-1', role: 'user', content: 'Finish this', timestamp: 1 },
      {
        id: 'tool-projection',
        role: 'assistant',
        content: '',
        timestamp: 2,
        toolCalls: [
          { id: 'call-1', name: 'read_file', arguments: '{}', status: 'completed' },
        ],
        assistantMetadata: {
          kind: 'intermediate',
          completionStatus: 'complete',
          finishReason: 'tool_calls',
        },
      },
    ];

    expect(findAgentRunReplaceableAssistantMessageId(messages, 'user-1')).toBeUndefined();
  });
});
