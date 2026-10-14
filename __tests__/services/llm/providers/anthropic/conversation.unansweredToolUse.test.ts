import { normalizeAnthropicConversationHistory } from '../../../../../src/services/llm/providers/anthropic/conversation';

// A tool_use left without its tool_result (a stopped run, a history cut) is stripped. Its
// thinking went with it only when the message held nothing else; otherwise the message ended
// in thinking and Claude refused the request: "messages.5: The final block in an assistant
// message cannot be `thinking`".

const THINKING = { type: 'thinking', thinking: 'Plan the call.', signature: 'sig' };
const TOOL_USE = { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'a.txt' } };

describe('normalizeAnthropicConversationHistory with an unanswered tool_use', () => {
  it('drops a turn that held only thinking and the unanswered call', () => {
    const normalized = normalizeAnthropicConversationHistory([
      { role: 'user', content: 'Read a.txt' },
      { role: 'assistant', content: [THINKING, TOOL_USE] },
      { role: 'user', content: 'Never mind.' },
    ]);

    expect(normalized).toEqual([{ role: 'user', content: 'Read a.txt\n\nNever mind.' }]);
  });

  it('keeps the text of a turn whose call went unanswered, without its thinking', () => {
    const normalized = normalizeAnthropicConversationHistory([
      { role: 'user', content: 'Read a.txt' },
      {
        role: 'assistant',
        content: [THINKING, { type: 'text', text: 'Reading it now.' }, TOOL_USE],
      },
      { role: 'user', content: 'Stop.' },
    ]);

    expect(normalized[1]).toEqual({ role: 'assistant', content: 'Reading it now.' });
    for (const message of normalized) {
      const blocks = Array.isArray(message.content) ? message.content : [];
      expect(blocks.at(-1)?.type).not.toBe('thinking');
    }
  });

  it('keeps thinking with an answered call', () => {
    const normalized = normalizeAnthropicConversationHistory([
      { role: 'user', content: 'Read a.txt' },
      { role: 'assistant', content: [THINKING, TOOL_USE] },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'hello' }],
      },
    ]);

    expect(normalized[1]).toEqual({ role: 'assistant', content: [THINKING, TOOL_USE] });
  });
});
