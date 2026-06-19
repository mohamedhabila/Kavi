import { selectAgentControlGraphModelContextMessages } from '../../src/engine/graph/modelContext';
import type { Message } from '../../src/types/message';

const msg = (id: string, role: Message['role'], content: string): Message => ({
  id,
  role,
  content,
  timestamp: 1,
});

describe('agent control graph model context', () => {
  it('keeps the memory-scoped conversation window for graph-owned runs', () => {
    const messages = [
      msg('u-old', 'user', 'Create old.txt'),
      msg('a-old', 'assistant', ''),
      msg('t-old', 'tool', 'old tool result'),
      msg('u-current', 'user', 'Create current.txt'),
      msg('a-current', 'assistant', ''),
      msg('t-current', 'tool', 'current tool result'),
    ];

    expect(
      selectAgentControlGraphModelContextMessages({
        memoryScopedMessages: messages,
        graphOwnedRun: true,
      }).map((message) => message.id),
    ).toEqual(['u-old', 'a-old', 't-old', 'u-current', 'a-current', 't-current']);
  });

  it('preserves ordinary memory scoping when the graph does not own an active run', () => {
    const sourceMessages = [
      msg('u-old', 'user', 'Old request'),
      msg('u-current', 'user', 'Current request'),
    ];
    const memoryScopedMessages = [sourceMessages[1]];

    expect(
      selectAgentControlGraphModelContextMessages({
        memoryScopedMessages,
        graphOwnedRun: false,
      }),
    ).toEqual(memoryScopedMessages);
  });
});
