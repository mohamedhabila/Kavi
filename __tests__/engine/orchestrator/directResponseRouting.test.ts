// ---------------------------------------------------------------------------
// Tests - Orchestrator: Direct response routing
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  LlmService,
  getPersona,
  mockStreamMessage,
  makeProvider,
  makeCallbacks,
  createStreamGenerator,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';

describe('Orchestrator', () => {
  describe('Direct response routing', () => {
    it('uses a lightweight direct-response prompt for standalone literal-token super-agent turns', async () => {
      const mockSendMessage = jest.fn();

      (LlmService as any).mockImplementation(() => ({
        streamMessage: mockStreamMessage,
        sendMessage: mockSendMessage,
      }));
      (getPersona as jest.Mock).mockReturnValue({
        id: 'super-agent',
        name: 'SuperAgent',
      });

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'CHECKNO42' },
          { type: 'done', content: 'CHECKNO42' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          name: 'Gemini',
          model: 'gemini-3.5-flash',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        }),
        model: 'gemini-3.5-flash',
        conversationId: 'conv-direct-response-fast-path',
        systemPrompt: 'You are helpful',
        personaId: 'super-agent',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'CHECKNO42',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockStreamMessage).toHaveBeenCalledTimes(1);
      const requestMessages = mockStreamMessage.mock.calls[0][0] as Array<{
        role: string;
        content: string;
      }>;
      expect(requestMessages[0].content).not.toContain('## Tool Call Style');
      expect(requestMessages[0].content).not.toContain('## Agent Mode');
      expect(requestMessages[0].content).not.toContain('Available orchestration tools');
      expect(requestMessages[0].content.length).toBeLessThan(2800);
      expect(callbacks.calls.onAssistantMessage.at(-1)).toEqual(
        expect.objectContaining({
          content: 'CHECKNO42',
        }),
      );
    });

    it('keeps exact-output worker-style turns text-only when no side effect is requested', async () => {
      const mockSendMessage = jest.fn();
      (LlmService as any).mockImplementation(() => ({
        streamMessage: mockStreamMessage,
        sendMessage: mockSendMessage,
      }));

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'C64A' },
          { type: 'done', content: 'C64A' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          name: 'Gemini',
          model: 'gemini-3.5-flash',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        }),
        model: 'gemini-3.5-flash',
        conversationId: 'worker-direct-output',
        systemPrompt: 'You are a worker.',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: "Please output 'C64A' and complete.",
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockStreamMessage).toHaveBeenCalledTimes(1);
      expect(callbacks.calls.onToolCallStart).toHaveLength(0);
      expect(callbacks.calls.onAssistantMessage.at(-1)).toEqual(
        expect.objectContaining({
          content: 'C64A',
        }),
      );
    });
  });
});
