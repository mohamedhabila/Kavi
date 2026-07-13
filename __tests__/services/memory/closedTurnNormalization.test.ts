import {
  findLastClosedTurn,
  normalizeTerminalClosedTurnMessages,
} from '../../../src/services/memory/closedTurn';
import type { Message } from '../../../src/types/message';

let messageSequence = 0;

function makeMessage(overrides: Partial<Message> = {}): Message {
  messageSequence += 1;
  return {
    id: `message-${messageSequence}`,
    role: 'user',
    content: '',
    timestamp: messageSequence,
    ...overrides,
  };
}

describe('closed-turn normalization helpers', () => {
  it('closes tool-only terminal assistants with final metadata', () => {
    const user = makeMessage({ role: 'user', content: 'List calendars' });
    const assistant = makeMessage({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc-1', name: 'calendar_list', arguments: '{}' }],
      assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
    });
    const closed = findLastClosedTurn([user, assistant]);
    expect(closed.user?.id).toBe(user.id);
    expect(closed.assistant?.id).toBe(assistant.id);
  });

  it('promotes tool-only assistants in the latest user slice before closure', () => {
    const user = makeMessage({ role: 'user', content: 'Run tools only' });
    const assistant = makeMessage({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc-1', name: 'calendar_list', arguments: '{}' }],
      assistantMetadata: {
        finishReason: 'stop',
        kind: 'intermediate',
        completionStatus: 'complete',
      },
    });
    const closed = findLastClosedTurn([user, assistant]);
    expect(closed.assistant?.assistantMetadata).toMatchObject({
      kind: 'final',
      completionStatus: 'complete',
    });
  });

  it('closes empty final assistants with terminal metadata', () => {
    const user = makeMessage({ role: 'user', content: 'weekend-planning-thread' });
    const assistant = makeMessage({
      role: 'assistant',
      content: '',
      assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
    });
    const closed = findLastClosedTurn([user, assistant]);
    expect(closed.user?.id).toBe(user.id);
    expect(closed.assistant?.id).toBe(assistant.id);
  });

  it('skips intermediate tool batches that are not terminal', () => {
    const user = makeMessage({ role: 'user', content: 'Hello' });
    const messages: Message[] = [
      user,
      makeMessage({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc-1', name: 'tool_catalog', arguments: '{}' }],
        assistantMetadata: {
          finishReason: 'stop',
          kind: 'intermediate',
          completionStatus: 'complete',
        },
      }),
      makeMessage({ role: 'tool', content: 'ok', toolCallId: 'tc-1' }),
      makeMessage({
        role: 'assistant',
        content: 'Done.',
        assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
      }),
    ];
    expect(findLastClosedTurn(messages).assistant?.content).toBe('Done.');
  });

  it('leaves a latest assistant with text unchanged', () => {
    const messages = [
      makeMessage({ role: 'user', content: 'Hi' }),
      makeMessage({ role: 'assistant', content: 'Hello' }),
    ];
    expect(normalizeTerminalClosedTurnMessages(messages)).toBe(messages);
  });

  it('promotes an empty no-tool assistant in the latest user turn slice', () => {
    const user = makeMessage({ role: 'user', content: 'plan-weekend-trip-42' });
    const assistant = makeMessage({ role: 'assistant', content: '' });
    const normalized = normalizeTerminalClosedTurnMessages([user, assistant]);
    expect(normalized[1]?.assistantMetadata).toMatchObject({
      kind: 'final',
      completionStatus: 'complete',
    });
    expect(findLastClosedTurn(normalized).assistant?.id).toBe(assistant.id);
  });
});
