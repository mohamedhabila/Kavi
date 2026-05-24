import type { Message } from '../../src/types';
import { excludeTrailingInternalUserMessages } from '../../src/services/context/messageScoping';

function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: overrides.id || `msg-${Math.random()}`,
    role: overrides.role || 'user',
    content: overrides.content || '',
    timestamp: overrides.timestamp ?? Date.now(),
    ...overrides,
  };
}

describe('messageScoping', () => {
  it('drops trailing user control prompts only from the end', () => {
    const messages: Message[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'real prompt' }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'draft' }),
      makeMessage({ id: 'u2', role: 'user', content: 'control prompt 1' }),
      makeMessage({ id: 'u3', role: 'user', content: 'control prompt 2' }),
    ];

    const out = excludeTrailingInternalUserMessages(messages, 2);
    expect(out.map((message) => message.id)).toEqual(['u1', 'a1']);
  });

  it('handles oversized and non-finite counts safely', () => {
    const messages: Message[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'real prompt' }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'draft' }),
    ];

    expect(excludeTrailingInternalUserMessages(messages, 99).map((message) => message.id)).toEqual([
      'a1',
    ]);
    expect(excludeTrailingInternalUserMessages(messages, Number.NaN)).toEqual(messages);
  });
});
