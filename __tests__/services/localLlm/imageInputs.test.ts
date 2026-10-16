import { Directory, Paths } from 'expo-file-system';

import {
  LOCAL_LLM_MAX_IMAGES_PER_TURN,
  LOCAL_LLM_VISUAL_TOKEN_BUDGET,
} from '../../../src/services/localLlm/constants';
import { withLocalImageFiles } from '../../../src/services/localLlm/imageInputs';
import { buildStructuredLocalConversation } from '../../../src/services/localLlm/structuredConversation';
import { keepLatestLocalImages } from '../../../src/services/localLlm/structuredMessages';
import type {
  LocalChatMessage,
  LocalLlmExecutionPolicy,
} from '../../../src/services/localLlm/types';

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD';
const RECEIPT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

function policy(overrides?: Partial<LocalLlmExecutionPolicy>): LocalLlmExecutionPolicy {
  return {
    modelId: 'gemma-4-E2B-it',
    modelName: 'Gemma 4 E2B',
    runtime: 'litert-lm',
    maxTokens: 1024,
    recommendedMaxTokens: 1024,
    maxContextLength: 32000,
    safeMaxContextWindowTokens: 8192,
    topK: 64,
    topP: 0.95,
    temperature: 1,
    minDeviceMemoryGb: 8,
    defaultVisionAccelerator: 'gpu',
    defaultAudioAccelerator: null,
    ...overrides,
  } as LocalLlmExecutionPolicy;
}

function userWith(text: string, ...images: string[]): LocalChatMessage {
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
    ],
  } as LocalChatMessage;
}

beforeEach(() => {
  (jest.requireMock('expo-file-system') as { __resetStore?: () => void }).__resetStore?.();
});

describe('on-device images', () => {
  it('shows a model that takes images the photo itself, and counts it in the context', () => {
    const conversation = buildStructuredLocalConversation(
      [userWith('What is on this receipt?', RECEIPT)],
      policy(),
    );
    const textOnly = buildStructuredLocalConversation(
      [{ role: 'user', content: 'What is on this receipt?' }],
      policy(),
    );

    expect(conversation.currentMessage).toEqual({
      role: 'user',
      content: 'What is on this receipt?',
      imageUris: [RECEIPT],
    });
    expect(conversation.estimatedInputTokens - textOnly.estimatedInputTokens).toBe(
      LOCAL_LLM_VISUAL_TOKEN_BUDGET,
    );
  });

  it('accepts a photo sent with no words', () => {
    const conversation = buildStructuredLocalConversation([userWith('', PHOTO)], policy());

    expect(conversation.currentMessage).toEqual({ role: 'user', imageUris: [PHOTO] });
  });

  it('tells a text-only model an image was left out', () => {
    const conversation = buildStructuredLocalConversation(
      [userWith('What is this?', PHOTO)],
      policy({ defaultVisionAccelerator: null }),
    );

    expect(conversation.currentMessage).toEqual({
      role: 'user',
      content: 'What is this?\n[Image omitted for local text model]',
    });
  });

  it('keeps images on the latest user message only, the last few of them', () => {
    const many = Array.from({ length: 6 }, (_, index) => `${PHOTO}${index}`);
    const messages = keepLatestLocalImages(
      [
        { role: 'user', content: 'Look at this', imageUris: [PHOTO] },
        { role: 'assistant', content: 'A cat.' },
        { role: 'user', content: 'And these?', imageUris: many },
        { role: 'assistant', toolCalls: [{ name: 'web_search', arguments: {} }] },
        { role: 'tool', toolResponses: [{ name: 'web_search', response: 'ok' }] },
      ],
      LOCAL_LLM_MAX_IMAGES_PER_TURN,
    );

    expect(messages[0]).toEqual({
      role: 'user',
      content: '[An image shared earlier]\nLook at this',
    });
    expect(messages[2]?.imageUris).toEqual(many.slice(-LOCAL_LLM_MAX_IMAGES_PER_TURN));
    expect(messages[4]).toEqual({
      role: 'tool',
      toolResponses: [{ name: 'web_search', response: 'ok' }],
    });
  });

  it('notes how many earlier images there were', () => {
    expect(
      keepLatestLocalImages(
        [
          { role: 'user', imageUris: [PHOTO, RECEIPT] },
          { role: 'user', content: 'Thanks' },
        ],
        LOCAL_LLM_MAX_IMAGES_PER_TURN,
      )[0],
    ).toEqual({ role: 'user', content: '[2 images shared earlier]' });
  });
});

describe('withLocalImageFiles', () => {
  it('writes each image once to the cache and hands the runtime its path', async () => {
    const first = await withLocalImageFiles({
      role: 'user',
      content: 'Hi',
      imageUris: [PHOTO, RECEIPT],
    });
    const again = await withLocalImageFiles({ role: 'user', imageUris: [PHOTO] });

    expect(first).toEqual({
      role: 'user',
      content: 'Hi',
      imagePaths: [
        expect.stringMatching(/local-llm\/inputs\/[0-9a-f]{32}\.jpg$/u),
        expect.stringMatching(/\.png$/u),
      ],
    });
    expect(first.imagePaths?.every((path) => !path.startsWith('file:'))).toBe(true);
    expect(again.imagePaths).toEqual([first.imagePaths?.[0]]);
  });

  it('keeps the cache to the latest sixteen images, never dropping the ones in use', async () => {
    for (let index = 0; index < 20; index += 1) {
      await withLocalImageFiles({ role: 'user', imageUris: [`${PHOTO}${index}`] });
    }
    const latest = await withLocalImageFiles({ role: 'user', imageUris: [`${PHOTO}19`] });
    const files = new Directory(Paths.cache, 'local-llm', 'inputs').list();

    expect(files).toHaveLength(16);
    expect(files.map((file) => file.uri)).toContain(`file://${latest.imagePaths?.[0]}`);
  });

  it('passes a message without images through untouched', async () => {
    await expect(withLocalImageFiles({ role: 'assistant', content: 'OK' })).resolves.toEqual({
      role: 'assistant',
      content: 'OK',
    });
  });

  it('refuses an image that is not a base64 data URI', async () => {
    await expect(
      withLocalImageFiles({ role: 'user', imageUris: ['https://example.com/cat.jpg'] }),
    ).rejects.toThrow('base64 data URI');
  });
});
