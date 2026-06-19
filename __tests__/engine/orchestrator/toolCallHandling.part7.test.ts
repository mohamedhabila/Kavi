// ---------------------------------------------------------------------------
// Tests - Orchestrator: Tool call handling part 7
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  executeTool,
  mockStreamMessage,
  makeProvider,
  allowTools,
  makeCallbacks,
  createStreamGenerator,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';

describe('Orchestrator', () => {
  describe('Tool call handling part 7', () => {
    it('does not accept a final answer while tracked background sessions are still running', async () => {
      (executeTool as jest.Mock)
        .mockResolvedValueOnce(
          JSON.stringify({
            status: 'running',
            sessionId: 'sub-1',
            guidance: 'Poll sessions_status until the session reaches a terminal state.',
          }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            status: 'completed',
            sessionCount: 1,
            sessions: [
              {
                sessionId: 'sub-1',
                status: 'completed',
                outputPreview: 'Worker finished the repository audit.',
                hasOutput: true,
              },
            ],
            pendingSessions: [],
          }),
        );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc1',
              name: 'sessions_spawn',
              arguments: '{"prompt":"Research this"}',
            },
          },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Worker completed successfully.' },
          { type: 'done', content: 'Worker completed successfully.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-background-join',
        systemPrompt: 'You are helpful',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Launch a worker and wait for it to finish.',
            timestamp: Date.now(),
          },
        ],
        toolFilter: allowTools(['sessions_spawn']),
      };

      await runOrchestrator(options, callbacks);

      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(executeTool).toHaveBeenNthCalledWith(
        1,
        'sessions_spawn',
        '{"prompt":"Research this"}',
        'conv-background-join',
        expect.any(Object),
      );
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('does not inject loop warnings for expected sessions_status plus sessions_wait monitoring', async () => {
      const runningStatus = JSON.stringify({
        sessionId: 'sub-1',
        status: 'running',
        currentActivity: 'Auditing repository',
        recommendedWaitMs: 5000,
        hasNewActivity: false,
      });
      const waitResult = JSON.stringify({
        status: 'running',
        sessionIds: ['sub-1'],
        sessionCount: 1,
        completedCount: 0,
        pendingCount: 1,
        sessions: [
          {
            sessionId: 'sub-1',
            status: 'running',
            currentActivity: 'Auditing repository',
            recommendedWaitMs: 5000,
            hasNewActivity: false,
          },
        ],
        pendingSessions: [
          {
            sessionId: 'sub-1',
            status: 'running',
            currentActivity: 'Auditing repository',
            recommendedWaitMs: 5000,
            hasNewActivity: false,
          },
        ],
      });

      (executeTool as jest.Mock)
        .mockResolvedValueOnce(
          JSON.stringify({
            status: 'running',
            sessionId: 'sub-1',
            guidance: 'Poll sessions_status until the session reaches a terminal state.',
          }),
        )
        .mockResolvedValueOnce(runningStatus)
        .mockResolvedValueOnce(waitResult)
        .mockResolvedValueOnce(runningStatus)
        .mockResolvedValueOnce(
          JSON.stringify({
            sessionId: 'sub-1',
            status: 'completed',
            outputPreview: 'Worker finished the repository audit.',
          }),
        );

      mockStreamMessage
        .mockImplementationOnce(() =>
          createStreamGenerator([
            {
              type: 'tool_call',
              toolCall: {
                id: 'tc1',
                name: 'sessions_spawn',
                arguments: '{"prompt":"Research this"}',
              },
            },
            { type: 'done', content: '' },
          ]),
        )
        .mockImplementationOnce(() =>
          createStreamGenerator([
            {
              type: 'tool_call',
              toolCall: { id: 'tc2', name: 'sessions_status', arguments: '{"sessionId":"sub-1"}' },
            },
            { type: 'done', content: '' },
          ]),
        )
        .mockImplementationOnce(() =>
          createStreamGenerator([
            {
              type: 'tool_call',
              toolCall: {
                id: 'tc3',
                name: 'sessions_wait',
                arguments: '{"sessionId":"sub-1","waitTimeoutMs":5000}',
              },
            },
            { type: 'done', content: '' },
          ]),
        )
        .mockImplementationOnce(() =>
          createStreamGenerator([
            {
              type: 'tool_call',
              toolCall: { id: 'tc4', name: 'sessions_status', arguments: '{"sessionId":"sub-1"}' },
            },
            { type: 'done', content: '' },
          ]),
        )
        .mockImplementationOnce(() =>
          createStreamGenerator([
            {
              type: 'tool_call',
              toolCall: { id: 'tc5', name: 'sessions_status', arguments: '{"sessionId":"sub-1"}' },
            },
            { type: 'done', content: '' },
          ]),
        )
        .mockImplementationOnce(() =>
          createStreamGenerator([
            { type: 'token', content: 'Worker completed successfully.' },
            { type: 'done', content: 'Worker completed successfully.' },
          ]),
        );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-monitor-loop-guard',
        systemPrompt: 'You are helpful',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Launch a worker and monitor it until it finishes.',
            timestamp: Date.now(),
          },
        ],
        toolFilter: allowTools(['sessions_spawn', 'sessions_status', 'sessions_wait']),
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage.mock.calls.length).toBeGreaterThanOrEqual(1);
      for (const [apiMessages] of mockStreamMessage.mock.calls) {
        expect(
          (apiMessages as Array<{ role: string; content?: string }>).some(
            (message) =>
              message.role === 'system' &&
              typeof message.content === 'string' &&
              message.content.startsWith('[SYSTEM WARNING'),
          ),
        ).toBe(false);
      }
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('re-prompts stalled no-tool turns with async hold guidance without auto-scheduling monitor tools', async () => {
      (executeTool as jest.Mock)
        .mockResolvedValueOnce(
          JSON.stringify({
            status: 'running',
            sessionId: 'sub-1',
            guidance: 'Poll sessions_wait until the session reaches a terminal state.',
          }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            status: 'completed',
            sessionCount: 1,
            sessions: [
              {
                sessionId: 'sub-1',
                status: 'completed',
                outputPreview: 'Worker finished the repository audit.',
                hasOutput: true,
              },
            ],
            pendingSessions: [],
          }),
        );

      mockStreamMessage
        .mockImplementationOnce(() =>
          createStreamGenerator([
            {
              type: 'tool_call',
              toolCall: {
                id: 'tc1',
                name: 'sessions_spawn',
                arguments: '{"prompt":"Research this"}',
              },
            },
            { type: 'done', content: '' },
          ]),
        )
        .mockImplementationOnce(() =>
          createStreamGenerator([
            { type: 'token', content: 'Worker completed successfully.' },
            { type: 'done', content: 'Worker completed successfully.' },
          ]),
        );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-background-hold-stall',
        systemPrompt: 'You are helpful',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Launch a worker and keep monitoring it until it finishes.',
            timestamp: Date.now(),
          },
        ],
        toolFilter: allowTools(['sessions_spawn']),
      };

      await runOrchestrator(options, callbacks);

      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(executeTool).toHaveBeenNthCalledWith(
        1,
        'sessions_spawn',
        '{"prompt":"Research this"}',
        'conv-background-hold-stall',
        expect.any(Object),
      );
      expect(callbacks.onDone).toHaveBeenCalled();
    });
  });
});
