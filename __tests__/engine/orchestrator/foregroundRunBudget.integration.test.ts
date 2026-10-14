// ---------------------------------------------------------------------------
// Tests - Orchestrator: a foreground run's tool budget (end-to-end)
// ---------------------------------------------------------------------------
// A foreground run (isForegroundRun: true, set only by the real chat entry point) used to
// be cut at 12 iterations or two minutes: the graph then forced a tool-less "report
// progress and ask whether to continue" turn, so a long task stopped mid-way on every
// model, however well it was going. A foreground run now gets the same budget as any run;
// the repeat and stagnation detectors still end a loop that makes no progress.

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

/** The run a 12-iteration foreground ceiling would have cut short. */
const TOOL_TURNS = 15;

/**
 * A provider that reads a distinct file per turn (so the loop detector never mistakes the
 * work for a stuck loop) and answers once it has made TOOL_TURNS tool calls.
 */
function mockLongToolTask() {
  let callIndex = 0;
  mockStreamMessage.mockImplementation(() => {
    callIndex += 1;
    if (callIndex > TOOL_TURNS) {
      return createStreamGenerator(
        [
          { type: 'token', content: 'Read every file.' },
          { type: 'done', content: 'Read every file.' },
        ],
        'text',
      );
    }
    return createStreamGenerator(
      [
        {
          type: 'tool_call',
          toolCall: {
            id: `tc-${callIndex}`,
            name: 'read_file',
            arguments: JSON.stringify({ path: `test-${callIndex}.txt` }),
          },
        },
        { type: 'done', content: '' },
      ],
      'tool',
    );
  });
  return () => callIndex;
}

describe('Orchestrator foreground run budget', () => {
  it('keeps offering tools to a foreground run past twelve iterations until it answers', async () => {
    const getCallCount = mockLongToolTask();
    (executeTool as jest.Mock).mockResolvedValue({ status: 'completed', content: 'ok' });

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider: makeProvider(),
      model: 'gpt-5.4',
      conversationId: 'conv-foreground-long-task',
      systemPrompt: 'You are helpful',
      isForegroundRun: true,
      toolFilter: allowTools(['read_file']),
      messages: [
        { id: 'msg1', role: 'user', content: 'Read all fifteen files.', timestamp: Date.now() },
      ],
    };

    const result = await runOrchestrator(options, callbacks);

    expect(getCallCount()).toBe(TOOL_TURNS + 1);
    expect(executeTool).toHaveBeenCalledTimes(TOOL_TURNS);
    for (const [, callOptions] of mockStreamMessage.mock.calls) {
      expect((callOptions.tools ?? []).map((tool: { name: string }) => tool.name)).toContain(
        'read_file',
      );
    }
    expect(callbacks.calls.onError).toHaveLength(0);
    expect(result.terminalDisposition).not.toBe('failed');
    const finalAssistant = callbacks.calls.onAssistantMessage.find(
      (entry) => entry.assistantMetadata?.kind === 'final',
    );
    expect(finalAssistant?.content).toContain('Read every file.');
  });
});
