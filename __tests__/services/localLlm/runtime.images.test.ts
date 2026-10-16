import {
  createExplicitAndroidLocalProvider,
  installLocalLlmRuntimeTestHarness,
  mockGenerateWithNativeLocalLlm,
  mockGetNativeLocalLlmAvailability,
  setPlatform,
} from '../../fixtures/localLlm/runtimeTestHarness';
import { sendLocalLlmMessage } from '../../../src/services/localLlm/generateSession';
import { installLocalLlmModel } from '../../../src/services/localLlm/install';

installLocalLlmRuntimeTestHarness();

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD';

function phoneAt(thermalState: string | null) {
  mockGetNativeLocalLlmAvailability.mockResolvedValue({
    available: true,
    linked: true,
    platform: 'android',
    runtime: 'litert-lm',
    reason: null,
    supportsStreaming: true,
    deviceMemoryGb: 8,
    lowMemoryDevice: false,
    thermalState,
  });
}

async function installedGemma() {
  const provider = createExplicitAndroidLocalProvider('gemma-4-E2B-it');
  return installLocalLlmModel(provider, provider.model);
}

function nativeRequest() {
  return mockGenerateWithNativeLocalLlm.mock.calls.at(-1)![0];
}

describe('a photo sent to Gemma 4 on the phone', () => {
  beforeEach(() => setPlatform('android', 31));

  it('reaches the runtime as an image file with the visual budget', async () => {
    phoneAt('nominal');
    await sendLocalLlmMessage(await installedGemma(), [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image_url', image_url: { url: PHOTO } },
        ],
      },
    ] as never);

    expect(nativeRequest()).toMatchObject({
      currentMessage: {
        role: 'user',
        content: 'What is this?',
        imagePaths: [expect.stringMatching(/local-llm\/inputs\/[0-9a-f]{32}\.jpg$/u)],
      },
      visionBackend: expect.any(String),
      visualTokenBudget: 280,
    });
  });

  it('sends the visual budget with the vision encoder, before any photo arrives', async () => {
    phoneAt('nominal');
    await sendLocalLlmMessage(await installedGemma(), [{ role: 'user', content: 'Hi' }] as never);

    // Android's engine reads the budget when it starts, so a text turn that starts it carries it.
    expect(nativeRequest()).toMatchObject({
      visionBackend: expect.any(String),
      visualTokenBudget: 280,
    });
  });
});
