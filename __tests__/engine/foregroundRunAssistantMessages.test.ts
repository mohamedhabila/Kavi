import type { Message } from '../../src/types/message';
import {
  findLatestAgentRunAssistantMessageId,
  findLatestIncompleteAgentRunAssistantMessage,
  findLatestPreferredAgentRunAssistantMessageId,
} from '../../src/engine/graph/foregroundRun/assistantMessages';

describe('foreground run assistant message lookup', () => {
  it('finds the visible final candidate after trailing recovery placeholders', () => {
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
      },
    ];

    const runScope = {
      userMessageId: 'compacted-user',
      runStartedAt: 90,
    };

    expect(findLatestAgentRunAssistantMessageId(messages, runScope)).toBe('final-answer');
    expect(findLatestPreferredAgentRunAssistantMessageId(messages, runScope)).toBe('final-answer');
  });

  it('keeps the latest visible incomplete draft discoverable after an empty placeholder', () => {
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

    expect(findLatestIncompleteAgentRunAssistantMessage(messages, runScope)?.id).toBe(
      'draft-answer',
    );
  });
});
