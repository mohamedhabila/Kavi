import {
  applyCompactionResultToWorkingMessages,
  estimateWorkingMessageTokens,
} from '../../src/engine/orchestratorCompaction';
import type { Message } from '../../src/types/message';

describe('orchestrator compaction', () => {
  it('counts canonical tool-call arguments when estimating working context', () => {
    const withoutToolCall: Message[] = [
      { id: 'assistant', role: 'assistant', content: '', timestamp: 1 },
    ];
    const withLargeToolCall: Message[] = [
      {
        ...withoutToolCall[0],
        toolCalls: [
          {
            id: 'write-1',
            name: 'write_file',
            arguments: JSON.stringify({ content: 'x'.repeat(20_000) }),
            status: 'completed',
          },
        ],
      },
    ];

    expect(estimateWorkingMessageTokens(withLargeToolCall)).toBeGreaterThan(
      estimateWorkingMessageTokens(withoutToolCall) + 5_000,
    );
  });

  it('marks a new durable summary with code-owned provenance', () => {
    const messages: Message[] = [
      { id: 'user-old', role: 'user', content: 'Original request', timestamp: 1 },
      { id: 'assistant-tail', role: 'assistant', content: 'Still working', timestamp: 2 },
    ];

    const event = applyCompactionResultToWorkingMessages(messages, {
      ok: true,
      compacted: true,
      tier: 'selective',
      result: {
        summary: '[Conversation Summary]\n\nOriginal request',
        firstKeptEntryId: 'assistant-tail',
        tokensBefore: 2_000,
        tokensAfter: 200,
      },
    });

    expect(event.messages[0]).toEqual(
      expect.objectContaining({
        role: 'system',
        compactionProvenance: { version: 1, dependency: 'transcript_only' },
      }),
    );
    expect(event.messages[1]?.id).toBe('assistant-tail');
  });
});
