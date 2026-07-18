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

function oversizedConversationMessages(): Message[] {
  const messages = Array.from({ length: 650 }, (_, index) => message(index));
  messages[20] = message(20);
  messages[21] = message(21, { role: 'assistant' });
  messages[22] = message(22, {
    role: 'tool',
    toolCallId: 'tool-call-22',
  });
  messages[23] = message(23, {
    role: 'assistant',
    assistantMetadata: {
      kind: 'final',
      completionStatus: 'complete',
      finishReason: 'stop',
    },
    memoryPublication: { version: 1, disposition: null },
  });
  return messages;
}

describe('open memory publication window persistence', () => {
  test('keeps receipt-free message capping behavior unchanged', () => {
    const small = Array.from({ length: 3 }, (_, index) => message(index));
    const oversized = Array.from({ length: 650 }, (_, index) => message(index));
    const expected = [oversized[0], ...oversized.slice(-(MAX_MESSAGES_PER_CONVERSATION - 1))];

    expect(capMessages(small)).toBe(small);
    expect(capMessages(oversized)).toEqual(expected);
  });

  test('caps around the complete open source window and the newest tail', () => {
    const capped = capMessages(oversizedConversationMessages());

    expect(capped).toHaveLength(MAX_MESSAGES_PER_CONVERSATION);
    expect(capped.slice(0, 5).map((entry) => entry.id)).toEqual([
      'message-0',
      'message-20',
      'message-21',
      'message-22',
      'message-23',
    ]);
    expect(capped[5].id).toBe('message-155');
    expect(capped.at(-1)?.id).toBe('message-649');
  });

  test('persists the same open window before assigning replay and reasoning tails', () => {
    const messages = oversizedConversationMessages().map((entry) => ({
      ...entry,
      reasoning: `reasoning-${entry.id}`,
      providerReplay: { openaiResponseId: `replay-${entry.id}` },
    }));

    const persisted = sanitizeConversationForPersistence(makeTestConversation({ messages }));

    expect(persisted.messages).toHaveLength(MAX_MESSAGES_PER_CONVERSATION);
    expect(persisted.messages.slice(0, 5).map((entry) => entry.id)).toEqual([
      'message-0',
      'message-20',
      'message-21',
      'message-22',
      'message-23',
    ]);
    expect(persisted.messages[4].memoryPublication).toEqual({
      version: 1,
      disposition: null,
    });
    expect(persisted.messages[4].reasoning).toBeUndefined();
    expect(persisted.messages[4].providerReplay).toBeUndefined();
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
