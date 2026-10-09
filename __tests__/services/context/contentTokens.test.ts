import { inspectContextBudget, windowMessages } from '../../../src/services/context/budgetManager';
import {
  estimateApiMessageCost,
  estimateApiMessagesTokens,
  estimateContentTokens,
  estimateImageInputTokens,
} from '../../../src/services/context/contentTokens';
import { estimateMessageTokens, estimateTokens } from '../../../src/services/context/tokenCounter';

/** A ~1 MB JPEG as the data URI the message formatter sends. */
const LARGE_IMAGE_URI = `data:image/jpeg;base64,${'A'.repeat(1_400_000)}`;

function imageMessage(text: string) {
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: LARGE_IMAGE_URI } },
    ],
  };
}

describe('estimateImageInputTokens', () => {
  it.each([
    ['anthropic', 4_784],
    ['openai', 3_000],
    ['gemini', 2_240],
    ['openrouter', 4_784],
    [undefined, 4_784],
  ])('uses the documented per-image ceiling for %s', (family, expected) => {
    expect(estimateImageInputTokens(family)).toBe(expected);
  });
});

describe('estimateContentTokens', () => {
  it('counts an image at its provider ceiling, not by its base64 length', () => {
    // Regression: the serialized payload of a ~1 MB photo estimated at hundreds of
    // thousands of tokens.
    const tokens = estimateContentTokens(imageMessage('What is this?').content, 'anthropic');

    expect(tokens).toBeGreaterThanOrEqual(4_784);
    expect(tokens).toBeLessThan(4_784 + 50);
  });

  it.each(['image', 'input_image'])('recognizes %s parts as images', (type) => {
    expect(estimateContentTokens([{ type, source: { data: 'A'.repeat(500_000) } }], 'openai')).toBe(
      3_000,
    );
  });

  it('keeps string content and non-image parts estimated as text', () => {
    expect(estimateContentTokens('hello world', 'openai')).toBe(
      estimateTokens('hello world', 'openai'),
    );
    const documentPart = [{ type: 'file', file: { filename: 'notes.txt' } }];
    expect(estimateContentTokens(documentPart, 'openai')).toBe(
      estimateTokens(JSON.stringify(documentPart), 'openai'),
    );
    expect(estimateContentTokens(undefined, 'openai')).toBe(0);
    expect(estimateContentTokens([], 'openai')).toBe(0);
  });

  it('counts each image in a multi-image message', () => {
    const content = [
      { type: 'image_url', image_url: { url: LARGE_IMAGE_URI } },
      { type: 'image_url', image_url: { url: LARGE_IMAGE_URI } },
    ];
    expect(estimateContentTokens(content, 'gemini')).toBe(2 * 2_240);
  });
});

describe('API message estimates', () => {
  it('matches the plain-text estimator for string content', () => {
    const messages = [
      { role: 'user', content: 'Plan a weekend in Lisbon' },
      { role: 'assistant', content: 'Here is a plan.' },
    ];
    expect(estimateApiMessagesTokens(messages, 'openai')).toBe(
      estimateMessageTokens(messages, 'openai'),
    );
  });

  it('adds tool calls to the message cost', () => {
    const toolCalls = [
      { id: 'tc1', type: 'function', function: { name: 'read_file', arguments: '{}' } },
    ];
    expect(
      estimateApiMessageCost({ role: 'assistant', content: '', tool_calls: toolCalls }, 'openai'),
    ).toBe(4 + estimateTokens(JSON.stringify(toolCalls), 'openai'));
  });

  it('does not put a request with one photo over budget', () => {
    const pressure = inspectContextBudget(
      'gpt-5.4',
      'You are helpful.',
      [],
      [imageMessage('Describe it')],
      4_096,
      {
        family: 'openai',
      },
    );

    expect(pressure.messagesTokens).toBeLessThan(10_000);
    expect(pressure.requiresMessageWindowing).toBe(false);
    expect(pressure.withinBudget).toBe(true);
  });

  it('keeps a photo turn when windowing a short history', () => {
    const messages = [
      { role: 'user', content: 'Earlier question' },
      { role: 'assistant', content: 'Earlier answer' },
      imageMessage('What is in this picture?'),
    ];

    expect(windowMessages(messages, 20_000, 'openai')).toHaveLength(3);
  });
});
