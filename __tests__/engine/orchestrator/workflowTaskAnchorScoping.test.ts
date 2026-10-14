// ---------------------------------------------------------------------------
// Tests - Orchestrator: workflow task anchor scoping
// ---------------------------------------------------------------------------
// The anchor protects task fidelity across long, delegation-capable execution: a run that
// can delegate (sessions_spawn on its surface) or is itself a delegated worker. It is shown
// only once the transcript no longer carries the request it copies.
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  mockStreamMessage,
  makeProvider,
  makeCallbacks,
  createStreamGenerator,
  allowTools,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';

const ANCHOR_HEADING = '## Workflow Task Anchor';

function okStream() {
  return createStreamGenerator(
    [
      { type: 'token', content: 'OK' },
      { type: 'done', content: 'OK' },
    ],
    'text',
  );
}

describe('Orchestrator', () => {
  describe('workflow task anchor scoping', () => {
    it('omits the anchor for a plain turn that cannot delegate', async () => {
      mockStreamMessage.mockImplementationOnce(okStream);

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-no-delegation',
        systemPrompt: 'You are helpful',
        // A real interactive chat turn always carries this.
        workflowScopeUserMessageId: 'msg1',
        // sessions_spawn is deliberately excluded from this turn's surface.
        toolFilter: allowTools(['web_search']),
        messages: [
          { id: 'msg1', role: 'user', content: 'Summarize this for me.', timestamp: Date.now() },
        ],
      };

      await runOrchestrator(options, callbacks);

      const apiMessages = mockStreamMessage.mock.calls[0][0];
      expect(apiMessages[0].content).not.toContain(ANCHOR_HEADING);
    });

    function toolCallThenFinalTextStreams() {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator(
          [
            { type: 'token', content: '' },
            {
              type: 'tool_call',
              toolCall: { id: 'tc1', name: 'web_search', arguments: '{"queries":["vendors"]}' },
            },
            { type: 'done', content: '' },
          ],
          'tool',
        ),
      );
      mockStreamMessage.mockImplementationOnce(okStream);
    }

    // A copy of a request the transcript still carries only added tokens, and adding it from
    // the second iteration on changed the prompt's uncached tail mid-turn.
    it('leaves the anchor out on every iteration while the transcript carries the request', async () => {
      toolCallThenFinalTextStreams();

      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-can-delegate',
        systemPrompt: 'You are helpful',
        workflowScopeUserMessageId: 'msg1',
        toolFilter: allowTools(['sessions_spawn', 'sessions_wait', 'web_search']),
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Research three vendors and summarize them.',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, makeCallbacks());

      expect(mockStreamMessage).toHaveBeenCalledTimes(2);
      expect(mockStreamMessage.mock.calls[0][0][0].content).not.toContain(ANCHOR_HEADING);
      expect(mockStreamMessage.mock.calls[1][0][0].content).not.toContain(ANCHOR_HEADING);
    });

    it('attaches the anchor once compaction has dropped the request from the transcript', async () => {
      mockStreamMessage.mockImplementationOnce(okStream);

      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-compacted',
        systemPrompt: 'You are helpful',
        workflowScopeUserMessageId: 'msg1',
        workflowTaskAnchor: {
          sourceMessageId: 'msg1',
          content: 'Research three vendors and summarize them.',
          attachments: [],
        },
        toolFilter: allowTools(['sessions_spawn', 'sessions_wait', 'web_search']),
        messages: [
          {
            id: 'msg2',
            role: 'user',
            content: 'Keep going with the vendor research.',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, makeCallbacks());

      expect(mockStreamMessage.mock.calls[0][0][0].content).toContain(ANCHOR_HEADING);
    });
  });
});
