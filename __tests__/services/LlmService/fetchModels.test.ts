// ---------------------------------------------------------------------------
// Tests - LLM Service: constructor and fetchModels
// ---------------------------------------------------------------------------

import {
  LlmService,
  makeConfig,
  makeOnDeviceConfig,
  mockFetch,
  mockGetSelectableLocalLlmModels,
} from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('constructor and fetchModels', () => {
    it('should create an instance with config', () => {
      const service = new LlmService(makeConfig());
      expect(service).toBeInstanceOf(LlmService);
    });

    it('should return models on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ id: 'gpt-5.4' }, { id: 'gpt-5-mini' }],
          }),
      });

      const service = new LlmService(makeConfig());
      const result = await service.fetchModels();

      expect(result.models).toContain('gpt-5-mini');
      expect(result.models).toContain('gpt-5.4');
      expect(result.models).toEqual([...result.models].sort());
    });

    it('should detect vision capabilities for gpt-5.4', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'gpt-5.4' }] }),
      });

      const service = new LlmService(makeConfig());
      const result = await service.fetchModels();

      expect(result.capabilities['gpt-5.4'].vision).toBe(true);
      expect(result.capabilities['gpt-5.4'].tools).toBe(true);
    });

    it('should detect non-tool models like whisper', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'whisper-1' }] }),
      });

      const service = new LlmService(makeConfig());
      const result = await service.fetchModels();

      expect(result.capabilities['whisper-1'].tools).toBe(false);
    });

    it('should handle array response format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: 'model-a' }, { id: 'model-b' }]),
      });

      const service = new LlmService(makeConfig());
      const result = await service.fetchModels();

      expect(result.models).toEqual(['model-a', 'model-b']);
    });

    it('should handle string array format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(['model-x', 'model-y']),
      });

      const service = new LlmService(makeConfig());
      const result = await service.fetchModels();

      expect(result.models).toEqual(['model-x', 'model-y']);
    });

    it('should return empty on failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const service = new LlmService(makeConfig());
      const result = await service.fetchModels();

      expect(result.models).toEqual([]);
    });

    it('should try alternate URL on first failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'fallback-model' }] }),
      });

      const service = new LlmService(makeConfig());
      const result = await service.fetchModels();

      expect(result.models).toContain('fallback-model');
    });

    it('should use default URL when config base URL is empty', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'model-1' }] }),
      });

      const service = new LlmService(makeConfig({ baseUrl: '' }));
      await service.fetchModels();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.openai.com'),
        expect.any(Object),
      );
    });

    it('returns on-device models without performing an HTTP fetch', async () => {
      mockGetSelectableLocalLlmModels.mockReturnValueOnce(['gemma-4-E4B-it', 'gemma-4-E2B-it']);

      const service = new LlmService(
        makeOnDeviceConfig({
          availableModels: ['gemma-4-E4B-it', 'gemma-4-E2B-it'],
          modelCapabilities: {
            'gemma-4-E4B-it': { vision: false, tools: false, fileInput: false },
            'gemma-4-E2B-it': { vision: false, tools: false, fileInput: false },
          },
        }),
      );
      const result = await service.fetchModels();

      expect(mockGetSelectableLocalLlmModels).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.models).toEqual(['gemma-4-E4B-it', 'gemma-4-E2B-it']);
      expect(result.capabilities['gemma-4-E2B-it']).toEqual({
        vision: false,
        tools: false,
        fileInput: false,
      });
    });
  });
});
