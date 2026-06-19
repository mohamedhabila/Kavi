// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeSessionHistory
// ---------------------------------------------------------------------------

import { executeSessionHistory, MOCK_PROVIDER } from '../../helpers/builtinExecutorHarness';

describe('Builtin Tool Executor', () => {
  describe('executeSessionHistory', () => {
    it('returns persisted transcript messages when bounded session context is available', async () => {
      const { getSubAgent, getSessionContext } = require('../../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        sessionId: 'hist-1',
        status: 'completed',
        startedAt: 10,
        updatedAt: 20,
        currentActivity: 'Done',
        output: 'Final output',
        activityLog: [{ timestamp: 15, kind: 'status', text: 'Completed read_file' }],
      });
      getSessionContext.mockReturnValueOnce({
        config: {
          parentConversationId: 'conv-1',
          prompt: 'Inspect the repository',
          linkUnderstandingEnabled: true,
          mediaUnderstandingEnabled: true,
        },
        provider: MOCK_PROVIDER,
        systemPrompt: 'You are a focused worker.',
        conversationSummary: 'Repository inspection completed.',
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'Inspect the repository',
            timestamp: 11,
            attachments: [
              {
                id: 'att-1',
                type: 'file',
                uri: 'file:///tmp/report.pdf',
                name: 'report.pdf',
                mimeType: 'application/pdf',
                size: 2048,
              },
            ],
          },
          {
            id: 'm2',
            role: 'assistant',
            content: 'Reading the main config file.',
            timestamp: 12,
            toolCalls: [{ id: 'tc-1', name: 'read_file', arguments: '{}', status: 'completed' }],
          },
          {
            id: 'm3',
            role: 'tool',
            content: '{"summary":"Config loaded"}',
            toolCallId: 'tc-1',
            timestamp: 13,
          },
          {
            id: 'm4',
            role: 'assistant',
            content: 'Repository inspection completed.',
            timestamp: 14,
          },
        ],
      });

      const result = await executeSessionHistory({ sessionId: 'hist-1', maxMessages: 4 });
      const parsed = JSON.parse(result);

      expect(parsed.historySource).toBe('persisted-transcript');
      expect(parsed.conversationSummary).toBe('Repository inspection completed.');
      expect(parsed.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'Inspect the repository',
            attachments: [expect.objectContaining({ id: 'att-1', name: 'report.pdf' })],
          }),
          expect.objectContaining({
            role: 'tool',
            content: '{"summary":"Config loaded"}',
            toolCallId: 'tc-1',
          }),
        ]),
      );
      expect(
        parsed.messages.find((message: any) => message.role === 'assistant')?.toolCalls,
      ).toEqual([expect.objectContaining({ id: 'tc-1', name: 'read_file', status: 'completed' })]);
    });

    it('falls back to activity log history without breaking JSON structure', async () => {
      const { getSubAgent, getSessionContext } = require('../../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        sessionId: 'hist-2',
        status: 'completed',
        startedAt: 100,
        updatedAt: 200,
        currentActivity: 'Idle',
        output: 'A'.repeat(6000),
        activityLog: Array.from({ length: 6 }, (_, index) => ({
          timestamp: 110 + index,
          kind: index % 2 === 0 ? 'status' : 'message',
          text: `Activity ${index}`,
        })),
      });
      getSessionContext.mockReturnValueOnce(undefined);

      const result = await executeSessionHistory({ sessionId: 'hist-2', maxMessages: 6 });
      const parsed = JSON.parse(result);

      expect(parsed.historySource).toBe('activity-log');
      expect(parsed.messages.length).toBeGreaterThan(0);
      expect(parsed.messages[parsed.messages.length - 1]).toEqual(
        expect.objectContaining({
          role: 'assistant',
        }),
      );
      expect(typeof result).toBe('string');
    });
  });
});
