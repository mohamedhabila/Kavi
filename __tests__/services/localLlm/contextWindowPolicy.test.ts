import { getAndroidLiteRtSafeTotalContextWindowTokens } from '../../../src/services/localLlm/contextWindowPolicy';

describe('localLlm context window policy', () => {
  it('keeps first Android LiteRT-LM requests conservative before backend stability is observed', () => {
    expect(
      getAndroidLiteRtSafeTotalContextWindowTokens({
        maxTokens: 4000,
        deviceMemoryGb: 16,
        minDeviceMemoryGb: 8,
        maxContextLength: 32_000,
        backend: 'gpu',
        observedBackend: null,
        lowMemoryDevice: false,
      }),
    ).toBe(8192);
  });

  it('expands context after a stable accelerated backend is observed with memory headroom', () => {
    expect(
      getAndroidLiteRtSafeTotalContextWindowTokens({
        maxTokens: 4000,
        deviceMemoryGb: 16,
        minDeviceMemoryGb: 8,
        maxContextLength: 32_000,
        backend: 'gpu',
        observedBackend: 'gpu',
        lowMemoryDevice: false,
      }),
    ).toBe(16_384);
  });

  it('does not expand context on low-memory or CPU fallback paths', () => {
    expect(
      getAndroidLiteRtSafeTotalContextWindowTokens({
        maxTokens: 4000,
        deviceMemoryGb: 16,
        minDeviceMemoryGb: 8,
        maxContextLength: 32_000,
        backend: 'gpu',
        observedBackend: 'gpu',
        lowMemoryDevice: true,
      }),
    ).toBe(8192);

    expect(
      getAndroidLiteRtSafeTotalContextWindowTokens({
        maxTokens: 4000,
        deviceMemoryGb: 16,
        minDeviceMemoryGb: 8,
        maxContextLength: 32_000,
        backend: 'cpu',
        observedBackend: 'cpu',
        lowMemoryDevice: false,
      }),
    ).toBe(8192);
  });

  it('respects model max context length while preserving output capacity', () => {
    expect(
      getAndroidLiteRtSafeTotalContextWindowTokens({
        maxTokens: 4096,
        deviceMemoryGb: 24,
        minDeviceMemoryGb: 8,
        maxContextLength: 12_000,
        backend: 'gpu',
        observedBackend: 'gpu',
        lowMemoryDevice: false,
      }),
    ).toBe(12_000);
  });
});
