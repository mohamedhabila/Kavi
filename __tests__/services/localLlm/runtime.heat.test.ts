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

describe('on-device requests on a hot phone', () => {
  beforeEach(() => setPlatform('android', 31));

  it('asks a cool phone for the full reply', async () => {
    phoneAt('nominal');
    await sendLocalLlmMessage(await installedGemma(), [{ role: 'user', content: 'Hi' }] as never);

    expect(nativeRequest().maxTokens).toBe(2048);
  });

  it('keeps replies short when the phone is seriously hot', async () => {
    phoneAt('serious');
    await sendLocalLlmMessage(await installedGemma(), [{ role: 'user', content: 'Hi' }] as never);

    expect(nativeRequest().maxTokens).toBe(1024);
  });

  it('cuts the reply and the context when it is critically hot, and still answers', async () => {
    phoneAt('critical');
    await sendLocalLlmMessage(await installedGemma(), [{ role: 'user', content: 'Hi' }] as never);

    expect(nativeRequest().maxTokens).toBe(512);
    expect(nativeRequest().contextWindowTokens).toBeLessThanOrEqual(4096);
  });
});
