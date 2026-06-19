// ---------------------------------------------------------------------------
// Tests - Orchestrator: Simple text response part 2
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  legacyFileSystem,
  mockStreamMessage,
  makeProvider,
  makeCallbacks,
  createStreamGenerator,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';

describe('Orchestrator', () => {
  describe('Simple text response part 2', () => {
    it('loads local image attachments from disk for the API payload', async () => {
      legacyFileSystem.readAsStringAsync.mockResolvedValueOnce('diskimagebase64');
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-image-attachment',
        systemPrompt: 'You are helpful',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Describe this image',
            attachments: [
              {
                id: 'att-1',
                type: 'image',
                uri: 'file:///photo.jpg',
                name: 'photo.jpg',
                mimeType: 'image/jpeg',
                size: 1024,
              },
            ],
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      const apiMessages = mockStreamMessage.mock.calls[0][0];
      expect(apiMessages[0].content).toContain('<runtime_context>');
      expect(apiMessages[0].content).toContain('request_timestamp_utc:');
      expect(apiMessages[1].content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: 'Describe this image',
          }),
          expect.objectContaining({
            type: 'image_url',
            image_url: { url: 'data:image/jpeg;base64,diskimagebase64' },
          }),
        ]),
      );
    });

    it('enables prompt caching while preserving the full planning budget for large actionable prompts', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

      const callbacks = makeCallbacks();
      callbacks.onUserMessageEnriched = jest.fn();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
        }),
        model: 'gpt-5.4',
        conversationId: 'conv-cache',
        systemPrompt: 'A'.repeat(20_000),
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Investigate this repository thoroughly',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      const [, streamOptions] = mockStreamMessage.mock.calls[0];
      expect(streamOptions.enablePromptCaching).toBe(true);
      expect(streamOptions.promptCacheKey).toContain('cm:');
      expect(streamOptions.maxTokens).toBe(32000);
    });

    it('keeps Gemini on native provider caching instead of synthesizing a generic cache key', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKey: 'AIza-test',
          model: 'gemini-3-flash-preview',
        }),
        model: 'gemini-3-flash-preview',
        conversationId: 'conv-gemini-cache',
        systemPrompt: 'A'.repeat(80_000),
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Investigate this repository thoroughly',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      const [, streamOptions] = mockStreamMessage.mock.calls[0];
      expect(streamOptions.enablePromptCaching).toBe(true);
      expect(streamOptions.promptCacheKey).toBeUndefined();
    });

    it('keeps runtime context in dynamic system sections and out of the active user turn', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

      const callbacks = makeCallbacks();
      callbacks.onUserMessageEnriched = jest.fn();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
        model: 'gpt-5.4',
        conversationId: 'conv-provider-agnostic-cache',
        systemPrompt: 'A'.repeat(9000),
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Investigate this repository thoroughly',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      const [apiMessages, streamOptions] = mockStreamMessage.mock.calls[0];
      expect(apiMessages[0]?.content).toContain(
        'Use the runtime_context block for request time and timezone.',
      );
      expect(apiMessages[0]?.content).not.toContain('Current time (UTC):');
      expect(apiMessages[0]?.content).toContain('<runtime_context>');
      expect(apiMessages[0]?.content).toContain('request_timestamp_utc:');
      expect(apiMessages[1]?.content).not.toContain('<runtime_context>');
      expect(streamOptions.enablePromptCaching).toBe(true);
      const systemPromptSections = streamOptions.systemPromptSections as Array<{
        cacheable?: boolean;
        text?: string;
      }>;
      expect(systemPromptSections.some((section) => section.cacheable === true)).toBe(true);
      expect(
        systemPromptSections.some(
          (section) => section.cacheable !== true && section.text?.includes('Runtime context:'),
        ),
      ).toBe(true);
      expect(callbacks.onUserMessageEnriched).not.toHaveBeenCalled();
    });
  });
});
