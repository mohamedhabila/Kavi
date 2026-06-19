// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeSessionSend part 1
// ---------------------------------------------------------------------------

import { executeSessionSend, MOCK_PROVIDER } from '../../helpers/builtinExecutorHarness';

describe('Builtin Tool Executor', () => {
  describe('executeSessionSend part 1', () => {
    it('returns error for non-existent session', async () => {
      const result = await executeSessionSend(
        {
          sessionId: 'sub-123',
          message: 'Hello sub-agent',
        },
        MOCK_PROVIDER,
      );
      expect(result).toContain('Error');
    });

    it('returns running status for active session', async () => {
      const { getSubAgent } = require('../../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({ status: 'running', sessionId: 'running-1' });
      const result = await executeSessionSend(
        { sessionId: 'running-1', message: 'ping' },
        MOCK_PROVIDER,
      );
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('running');
      expect(parsed.message).toContain('still processing');
    });

    it('rejects blank follow-up messages before re-spawning a worker', async () => {
      const { getSubAgent, launchSubAgent } = require('../../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Previous answer',
        parentConversationId: 'conv-1',
      });

      const result = await executeSessionSend(
        { sessionId: 'done-1', message: '   ' as any },
        MOCK_PROVIDER,
      );
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('error');
      expect(parsed.error).toBe('Worker message must be a non-empty string.');
      expect(launchSubAgent).not.toHaveBeenCalled();
    });

    it('launches a follow-up worker in the background by default', async () => {
      const {
        getSubAgent,
        getSessionContext,
        launchSubAgent,
      } = require('../../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Previous answer',
        parentConversationId: 'conv-1',
      });
      getSessionContext.mockReturnValueOnce({
        config: {
          prompt: 'Original task',
          systemPrompt: 'You are a focused worker.',
          tools: ['read_file'],
          sandboxPolicy: 'safe-only',
          workstreamId: 'workstream-2',
          name: 'Research Worker',
        },
        provider: MOCK_PROVIDER,
        conversationSummary: 'Previous answer',
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'Original task',
            enrichedContent:
              'Original task\n\n<attachment_context>Image shows a failing CI build.</attachment_context>',
            timestamp: 1,
            attachments: [
              {
                id: 'att-1',
                type: 'image',
                uri: 'file:///tmp/build.png',
                name: 'build.png',
                mimeType: 'image/png',
                size: 1024,
              },
            ],
          },
          { id: 'm2', role: 'assistant', content: 'Previous answer', timestamp: 2 },
        ],
      });
      launchSubAgent.mockResolvedValueOnce({
        sessionId: 'new-123',
        status: 'running',
        depth: 2,
      });
      const result = await executeSessionSend(
        { sessionId: 'old-123', message: 'Tell me more' },
        MOCK_PROVIDER,
      );
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('running');
      expect(parsed.sessionId).toBe('new-123');
      expect(parsed.previousSessionId).toBe('old-123');
      expect(parsed.workstreamId).toBe('workstream-2');
      expect(parsed.guidance).toContain('running in the background');
      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'conv-1',
          parentSessionId: 'old-123',
          prompt: 'Tell me more',
          systemPrompt: 'You are a focused worker.',
          tools: ['read_file'],
          sandboxPolicy: 'safe-only',
          workstreamId: 'workstream-2',
          name: 'Research Worker',
          initialMessages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: 'Original task',
              enrichedContent:
                'Original task\n\n<attachment_context>Image shows a failing CI build.</attachment_context>',
              attachments: [expect.objectContaining({ id: 'att-1', uri: 'file:///tmp/build.png' })],
            }),
            expect.objectContaining({ role: 'assistant', content: 'Previous answer' }),
            expect.objectContaining({ role: 'user', content: 'Tell me more' }),
          ]),
          linkUnderstandingEnabled: true,
          mediaUnderstandingEnabled: true,
        }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it('resolves the owning conversation for follow-up workers from nested sessions', async () => {
      const {
        getSubAgent,
        listActiveSubAgents,
        launchSubAgent,
      } = require('../../../src/services/agents/subAgent');

      getSubAgent.mockReturnValueOnce({
        sessionId: 'old-nested',
        status: 'completed',
        output: 'Previous answer',
        parentConversationId: 'sub-root',
      });
      listActiveSubAgents.mockReturnValueOnce([
        { sessionId: 'old-nested', parentConversationId: 'sub-root' },
        { sessionId: 'sub-root', parentConversationId: 'conv-1' },
      ]);
      launchSubAgent.mockResolvedValueOnce({
        sessionId: 'new-nested',
        status: 'running',
        depth: 2,
      });

      await executeSessionSend(
        { sessionId: 'old-nested', message: 'Continue the nested task' },
        MOCK_PROVIDER,
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'conv-1',
          parentSessionId: 'old-nested',
          workspaceConversationId: 'conv-1',
        }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it.each([
      {
        label: 'OpenAI Responses replay',
        provider: {
          ...MOCK_PROVIDER,
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.4',
        },
        assistantMessage: {
          id: 'a-openai',
          role: 'assistant',
          content: 'Checking the file.',
          timestamp: 2,
          providerReplay: {
            openaiResponseOutput: [
              {
                id: 'rs_prev',
                type: 'reasoning',
                summary: [{ type: 'summary_text', text: 'Need file contents' }],
              },
              {
                id: 'msg_prev',
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'Checking the file.', annotations: [] }],
              },
            ],
          },
          toolCalls: [
            {
              id: 'call_openai_1',
              name: 'read_file',
              arguments: '{"path":"notes.txt"}',
              status: 'completed',
              raw: {
                id: 'call_openai_1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
              },
            },
          ],
        },
      },
      {
        label: 'Anthropic assistant blocks',
        provider: {
          ...MOCK_PROVIDER,
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet-4-6',
        },
        assistantMessage: {
          id: 'a-anthropic',
          role: 'assistant',
          content: '',
          timestamp: 2,
          providerReplay: {
            anthropicBlocks: [
              { type: 'thinking', thinking: 'Inspect the file first.', signature: 'sig-A' },
              {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'read_file',
                input: { path: 'notes.txt' },
              },
            ],
          },
          toolCalls: [
            {
              id: 'toolu_1',
              name: 'read_file',
              arguments: '{"path":"notes.txt"}',
              status: 'completed',
              raw: {
                id: 'toolu_1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
              },
            },
          ],
        },
      },
      {
        label: 'Gemini native replay',
        provider: {
          ...MOCK_PROVIDER,
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          model: 'gemini-2.5-pro',
        },
        assistantMessage: {
          id: 'a-gemini',
          role: 'assistant',
          content: '',
          timestamp: 2,
          providerReplay: {
            geminiParts: [
              {
                functionCall: { id: 'tc1', name: 'read_file', args: { path: 'notes.txt' } },
                thoughtSignature: 'sig-G',
              },
            ],
          },
          toolCalls: [
            {
              id: 'tc1',
              name: 'read_file',
              arguments: '{"path":"notes.txt"}',
              status: 'completed',
              raw: {
                id: 'tc1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
                extra_content: { google: { thought_signature: 'sig-G' } },
              },
            },
          ],
        },
      },
    ])(
      'preserves $label in follow-up worker transcripts',
      async ({ provider, assistantMessage }) => {
        const {
          getSubAgent,
          getSessionContext,
          launchSubAgent,
        } = require('../../../src/services/agents/subAgent');
        getSubAgent.mockReturnValueOnce({
          status: 'completed',
          output: 'Previous answer',
          parentConversationId: 'conv-1',
        });
        getSessionContext.mockReturnValueOnce({
          config: {
            prompt: 'Original task',
            tools: ['read_file'],
          },
          provider,
          conversationSummary: 'Previous answer',
          messages: [
            { id: 'u1', role: 'user', content: 'Original task', timestamp: 1 },
            assistantMessage,
            {
              id: 't1',
              role: 'tool',
              content: 'file contents',
              toolCallId: assistantMessage.toolCalls[0].id,
              timestamp: 3,
            },
          ],
        });
        launchSubAgent.mockResolvedValueOnce({
          sessionId: 'new-follow-up',
          status: 'running',
          depth: 2,
        });

        await executeSessionSend({ sessionId: 'old-ctx', message: 'Continue the task' }, provider);

        const followUpConfig = launchSubAgent.mock.calls[0][0];
        const replayedAssistantMessage = followUpConfig.initialMessages.find(
          (message: any) => message.role === 'assistant',
        );

        expect(replayedAssistantMessage.toolCalls).toEqual(assistantMessage.toolCalls);
        if (assistantMessage.providerReplay) {
          expect(replayedAssistantMessage.providerReplay).toEqual(assistantMessage.providerReplay);
        } else {
          expect(replayedAssistantMessage.providerReplay).toBeUndefined();
        }
        expect(followUpConfig.initialMessages.at(-1)).toMatchObject({
          role: 'user',
          content: 'Continue the task',
        });
      },
    );
  });
});
