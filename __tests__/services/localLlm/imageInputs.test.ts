import { Directory, Paths } from 'expo-file-system';

import {
  LOCAL_LLM_MAX_IMAGES_PER_TURN,
  LOCAL_LLM_VISUAL_TOKEN_BUDGET,
} from '../../../src/services/localLlm/constants';
import { withLocalImageFiles } from '../../../src/services/localLlm/imageInputs';
import { buildStructuredLocalConversation } from '../../../src/services/localLlm/structuredConversation';
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

  it('keeps a photo in the history of the next turn, as the turn that sent it committed it', () => {
    const photoTurn = buildStructuredLocalConversation(
      [userWith('What is this?', PHOTO)],
      policy(),
    );
    const followUp = buildStructuredLocalConversation(
      [
        userWith('What is this?', PHOTO),
        { role: 'assistant', content: 'A red car.' },
        { role: 'user', content: 'What colour are its wheels?' },
      ],
      policy(),
    );

    // The native conversation cache is reused only when this history entry is the message
    // the photo turn sent; it still carries the photo for a fresh prefill.
    expect(followUp.history[0]).toEqual(photoTurn.currentMessage);
  });

  it('shows the model the last few images of a message', () => {
    const many = Array.from({ length: 6 }, (_, index) => `${PHOTO}${index}`);
    const conversation = buildStructuredLocalConversation([userWith('These?', ...many)], policy());

    expect(conversation.currentMessage.imageUris).toEqual(
      many.slice(-LOCAL_LLM_MAX_IMAGES_PER_TURN),
    );
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
