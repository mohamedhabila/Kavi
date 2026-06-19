import { buildDisplayMessages } from '../../src/components/chat/messageGrouping';
import { Message } from '../../src/types/message';
const timestamp = Date.now();
function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: 'message-id',
    role: 'assistant',
    content: '',
    timestamp,
    ...overrides,
  };
}

describe('buildDisplayMessages', () => {
  it('keeps structured sub-agent events inline within an ongoing assistant response', () => {
    const items = buildDisplayMessages([
      makeMessage({ id: 'user-1', role: 'user', content: 'Investigate this' }),
      makeMessage({
        id: 'assistant-1',
        role: 'assistant',
        content: 'Delegating the file audit.',
      }),
      makeMessage({
        id: 'assistant-2',
        role: 'assistant',
        content: 'Sub-agent Backend Architect completed in 12s.',
        subAgentEvent: {
          type: 'sub-agent',
          event: 'completed',
          snapshot: {
            sessionId: 'sub-123',
            parentConversationId: 'conv-1',
            parentSessionId: 'sub-root',
            name: 'Backend Architect',
            depth: 1,
            startedAt: timestamp - 12_000,
            updatedAt: timestamp,
            status: 'completed',
            sandboxPolicy: 'safe-only',
            output: 'Done.',
            toolsUsed: ['read_file'],
            iterations: 1,
          },
        },
      }),
      makeMessage({
        id: 'assistant-3',
        role: 'assistant',
        content: 'I will summarize the worker result.',
      }),
      makeMessage({
        id: 'assistant-4',
        role: 'assistant',
        content: 'The audit is complete.',
      }),
    ]);

    expect(items).toHaveLength(2);
    expect(items[1].sourceMessageIds).toEqual([
      'assistant-1',
      'assistant-2',
      'assistant-3',
      'assistant-4',
    ]);
    expect(items[1].retryMessageId).toBe('assistant-4');
    expect(items[1].responseSegments).toEqual([
      expect.objectContaining({ messageId: 'assistant-1', subAgentEvent: undefined }),
      expect.objectContaining({
        messageId: 'assistant-2',
        subAgentEvent: expect.objectContaining({
          type: 'sub-agent',
          event: 'completed',
          snapshot: expect.objectContaining({ sessionId: 'sub-123', depth: 1 }),
        }),
      }),
      expect.objectContaining({
        messageId: 'assistant-3',
        content: 'I will summarize the worker result.',
      }),
      expect.objectContaining({ messageId: 'assistant-4', content: 'The audit is complete.' }),
    ]);
  });
  it('keeps adjacent sub-agent lifecycle events visible within the transcript item', () => {
    const items = buildDisplayMessages([
      makeMessage({ id: 'user-1', role: 'user', content: 'Investigate this' }),
      makeMessage({
        id: 'assistant-1',
        role: 'assistant',
        content: 'Planner started.',
        subAgentEvent: {
          type: 'sub-agent',
          event: 'started',
          snapshot: {
            sessionId: 'sub-1',
            parentConversationId: 'conv-1',
            name: 'Planner',
            depth: 0,
            startedAt: timestamp - 5_000,
            updatedAt: timestamp - 4_000,
            status: 'running',
            sandboxPolicy: 'inherit',
          },
        },
      }),
      makeMessage({
        id: 'assistant-2',
        role: 'assistant',
        content: 'Planner completed.',
        subAgentEvent: {
          type: 'sub-agent',
          event: 'completed',
          snapshot: {
            sessionId: 'sub-1',
            parentConversationId: 'conv-1',
            name: 'Planner',
            depth: 0,
            startedAt: timestamp - 5_000,
            updatedAt: timestamp,
            status: 'completed',
            sandboxPolicy: 'inherit',
          },
        },
      }),
    ]);

    expect(items).toHaveLength(2);
    expect(items[1].id).toBe('assistant-1');
    expect(items[1].sourceMessageIds).toEqual(['assistant-1', 'assistant-2']);
    expect(items[1].message.subAgentEvent).toEqual(
      expect.objectContaining({
        event: 'completed',
        snapshot: expect.objectContaining({
          sessionId: 'sub-1',
          status: 'completed',
        }),
      }),
    );
    expect(items[1].responseSegments).toEqual([
      expect.objectContaining({
        id: 'segment-assistant-1',
        messageId: 'assistant-1',
        subAgentEvent: expect.objectContaining({
          event: 'started',
          snapshot: expect.objectContaining({ sessionId: 'sub-1', status: 'running' }),
        }),
      }),
      expect.objectContaining({
        id: 'segment-assistant-2',
        messageId: 'assistant-2',
        subAgentEvent: expect.objectContaining({
          event: 'completed',
          snapshot: expect.objectContaining({ sessionId: 'sub-1', status: 'completed' }),
        }),
      }),
    ]);
  });
  it('keeps same-session lifecycle updates across skipped tool messages visible without duplicating the row', () => {
    const items = buildDisplayMessages([
      makeMessage({ id: 'user-1', role: 'user', content: 'Investigate this' }),
      makeMessage({
        id: 'assistant-1',
        role: 'assistant',
        content: 'Planner started.',
        subAgentEvent: {
          type: 'sub-agent',
          event: 'started',
          snapshot: {
            sessionId: 'sub-1',
            parentConversationId: 'conv-1',
            name: 'Planner',
            depth: 0,
            startedAt: timestamp - 5_000,
            updatedAt: timestamp - 4_000,
            status: 'running',
            sandboxPolicy: 'inherit',
          },
        },
      }),
      makeMessage({ id: 'tool-msg', role: 'tool', content: 'ignored tool output' }),
      makeMessage({
        id: 'assistant-2',
        role: 'assistant',
        content: 'Planner completed.',
        subAgentEvent: {
          type: 'sub-agent',
          event: 'completed',
          snapshot: {
            sessionId: 'sub-1',
            parentConversationId: 'conv-1',
            name: 'Planner',
            depth: 0,
            startedAt: timestamp - 5_000,
            updatedAt: timestamp,
            status: 'completed',
            sandboxPolicy: 'inherit',
          },
        },
      }),
    ]);

    expect(items).toHaveLength(2);
    expect(items[1].id).toBe('assistant-1');
    expect(items[1].sourceMessageIds).toEqual(['assistant-1', 'assistant-2']);
    expect(items[1].responseSegments).toEqual([
      expect.objectContaining({
        id: 'segment-assistant-1',
        messageId: 'assistant-1',
        subAgentEvent: expect.objectContaining({
          event: 'started',
          snapshot: expect.objectContaining({ sessionId: 'sub-1', status: 'running' }),
        }),
      }),
      expect.objectContaining({
        id: 'segment-assistant-2',
        messageId: 'assistant-2',
        subAgentEvent: expect.objectContaining({
          event: 'completed',
          snapshot: expect.objectContaining({ sessionId: 'sub-1', status: 'completed' }),
        }),
      }),
    ]);
  });
  it('keeps adjacent sub-agent lifecycle events separate when they belong to different sessions', () => {
    const items = buildDisplayMessages([
      makeMessage({ id: 'user-1', role: 'user', content: 'Investigate this' }),
      makeMessage({
        id: 'assistant-1',
        role: 'assistant',
        content: 'Planner started.',
        subAgentEvent: {
          type: 'sub-agent',
          event: 'started',
          snapshot: {
            sessionId: 'sub-1',
            parentConversationId: 'conv-1',
            name: 'Planner',
            depth: 0,
            startedAt: timestamp - 5_000,
            updatedAt: timestamp - 4_000,
            status: 'running',
            sandboxPolicy: 'inherit',
          },
        },
      }),
      makeMessage({
        id: 'assistant-2',
        role: 'assistant',
        content: 'Researcher started.',
        subAgentEvent: {
          type: 'sub-agent',
          event: 'started',
          snapshot: {
            sessionId: 'sub-2',
            parentConversationId: 'conv-1',
            name: 'Researcher',
            depth: 0,
            startedAt: timestamp - 5_000,
            updatedAt: timestamp - 4_000,
            status: 'running',
            sandboxPolicy: 'inherit',
          },
        },
      }),
    ]);

    expect(items).toHaveLength(3);
    expect(items[1].sourceMessageIds).toEqual(['assistant-1']);
    expect(items[2].sourceMessageIds).toEqual(['assistant-2']);
  });
});
