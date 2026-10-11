import { sanitizeConversationForPersistence } from '../../src/store/chatPersistence';
import { capMessages, MAX_MESSAGES_PER_CONVERSATION } from '../../src/store/chatStoreHelpers';
import type { Message } from '../../src/types/message';
import { makeTestAgentRun, makeTestConversation } from '../helpers/factories';

function message(index: number, overrides: Partial<Message> = {}): Message {
  return {
    id: `message-${index}`,
    role: 'user',
    content: `message-${index}`,
    timestamp: index,
    ...overrides,
  };
}

describe('message persistence selection', () => {
  test('keeps the first message and the newest tail of an oversized conversation', () => {
    const small = Array.from({ length: 3 }, (_, index) => message(index));
    const oversized = Array.from({ length: 650 }, (_, index) => message(index));
    const expected = [oversized[0], ...oversized.slice(-(MAX_MESSAGES_PER_CONVERSATION - 1))];

    expect(capMessages(small)).toBe(small);
    expect(capMessages(oversized)).toEqual(expected);
  });

  test('assigns replay and reasoning tails within the persisted window', () => {
    const messages = Array.from({ length: 650 }, (_, index) => ({
      ...message(index),
      reasoning: `reasoning-message-${index}`,
      providerReplay: { openaiResponseId: `replay-message-${index}` },
    }));

    const persisted = sanitizeConversationForPersistence(makeTestConversation({ messages }));

    expect(persisted.messages).toHaveLength(MAX_MESSAGES_PER_CONVERSATION);
    expect(persisted.messages[0].id).toBe('message-0');
    expect(persisted.messages[0].reasoning).toBeUndefined();
    expect(persisted.messages[0].providerReplay).toBeUndefined();
    expect(persisted.messages.at(-24)?.reasoning).toBe('reasoning-message-626');
    expect(persisted.messages.at(-25)?.reasoning).toBeUndefined();
    expect(persisted.messages.at(-8)?.providerReplay).toEqual({
      openaiResponseId: 'replay-message-642',
    });
    expect(persisted.messages.at(-9)?.providerReplay).toBeUndefined();
  });

  test('retains an active agent run request outside the newest transcript window', () => {
    const messages = Array.from({ length: 650 }, (_, index) => message(index));
    const source = messages[50]!;
    const persisted = sanitizeConversationForPersistence(
      makeTestConversation({
        messages,
        activeAgentRunId: 'run-long-task',
        agentRuns: [
          makeTestAgentRun({
            id: 'run-long-task',
            userMessageId: source.id,
            workflowTaskAnchor: {
              sourceMessageId: source.id,
              content: source.content,
              attachments: [],
            },
            status: 'running',
          }),
        ],
      }),
    );

    expect(persisted.messages).toHaveLength(MAX_MESSAGES_PER_CONVERSATION);
    expect(persisted.messages.some((entry) => entry.id === source.id)).toBe(true);
  });
});
