import { readReplyText } from '../../../../src/services/llm/support/replyText';

describe('readReplyText', () => {
  it('reads every reply shape a provider returns', () => {
    expect(readReplyText('plain')).toBe('plain');
    expect(readReplyText({ choices: [{ message: { content: 'chat' } }] })).toBe('chat');
    expect(
      readReplyText({
        choices: [
          { message: { content: ['a', { text: 'b' }, { output_text: 'c' }, { image: 1 }, null] } },
        ],
      }),
    ).toBe('abc');
    expect(readReplyText({ output_text: 'responses' })).toBe('responses');
  });

  it('returns no text when the reply carries none', () => {
    expect(readReplyText(null)).toBe('');
    expect(readReplyText(42)).toBe('');
    expect(readReplyText({ choices: [] })).toBe('');
    expect(readReplyText({ choices: [{ message: { content: { text: 'x' } } }] })).toBe('');
  });
});
