import { exportConversationAsMarkdown } from '../../../src/services/session/manager';
import type { Conversation } from '../../../src/types/conversation';
import type { Message } from '../../../src/types/message';

// An export of a long-running conversation used to start wherever its in-memory window
// began; archived history now comes first, in order.

function message(id: string, content: string, timestamp: number): Message {
  return { id, role: 'user', content, timestamp } as Message;
}

describe('exportConversationAsMarkdown', () => {
  it('includes archived history between the first message and the recent ones', () => {
    const conversation = {
      id: 'c1',
      title: 'One conversation',
      createdAt: 1,
      messages: [message('first', 'First request', 1), message('recent', 'Recent request', 9)],
    } as Conversation;

    const markdown = exportConversationAsMarkdown(conversation, [
      message('archived', 'Archived request', 5),
    ]);

    const order = ['First request', 'Archived request', 'Recent request'].map((text) =>
      markdown.indexOf(text),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
  });
});
