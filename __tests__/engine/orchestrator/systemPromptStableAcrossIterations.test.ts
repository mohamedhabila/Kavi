// ---------------------------------------------------------------------------
// Tests - Orchestrator: the system prompt holds still through a tool loop
// ---------------------------------------------------------------------------
// Measured on the full Sonnet 5.5 suite: the second model call of every tool-using turn read
// only the fixed 5,379-token prefix from cache instead of the first call's whole prompt. Two
// sections joined the prompt's uncached tail from the second iteration on: a "Request
// Understanding Projection" (about 220 tokens of routing bookkeeping) and the workflow task
// anchor, a copy of the request the transcript already carried. Everything after the changed
// tail was processed again at full price on every such turn.

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

describe('the system prompt through a tool loop', () => {
  it('is the same on the call after a tool ran as on the call before it', async () => {
    let callIndex = 0;
    mockStreamMessage.mockImplementation(() => {
      callIndex += 1;
      return callIndex === 1
        ? createStreamGenerator(
            [
              {
                type: 'tool_call',
                toolCall: { id: 'tc-1', name: 'read_file', arguments: '{"path":"notes.md"}' },
              },
              { type: 'done', content: '' },
            ],
            'tool',
          )
        : createStreamGenerator(
            [
              { type: 'token', content: 'The review is on Friday.' },
              { type: 'done', content: 'The review is on Friday.' },
            ],
            'text',
          );
    });
    (executeTool as jest.Mock).mockResolvedValue({ status: 'completed', content: 'Friday.' });

    const options: OrchestratorOptions = {
      provider: makeProvider(),
      model: 'gpt-5.4',
      conversationId: 'conv-stable-system-prompt',
      systemPrompt: 'You are helpful',
      toolFilter: allowTools(['read_file']),
      messages: [{ id: 'msg1', role: 'user', content: 'When is the review?', timestamp: 1 }],
    };

    await runOrchestrator(options, makeCallbacks());

    expect(mockStreamMessage).toHaveBeenCalledTimes(2);
    const uncachedSectionsOf = (call: number) =>
      (
        mockStreamMessage.mock.calls[call][1].systemPromptSections as Array<{
          text: string;
          cacheable?: boolean;
        }>
      )
        .filter((section) => section.cacheable !== true)
        .map((section) => section.text);
    expect(uncachedSectionsOf(1)).toEqual(uncachedSectionsOf(0));
  });
});
