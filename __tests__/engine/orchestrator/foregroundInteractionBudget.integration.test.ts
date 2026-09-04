// ---------------------------------------------------------------------------
// Tests - Orchestrator: foreground interaction budget (end-to-end)
// ---------------------------------------------------------------------------
// A foreground interactive run (isForegroundRun: true, set only by the real
// chat entry point) is bounded far tighter than a background/delegated run:
// it forces a text-only checkpoint turn instead of grinding on unseen. The
// pure decision function has its own unit coverage
// (__tests__/engine/graph/foregroundRun/foregroundInteractionBudget.test.ts);
// these tests prove the wiring through the real orchestrator loop.

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
import { FOREGROUND_MAX_TOOL_ITERATIONS } from '../../../src/engine/orchestrator/constants';

/**
 * A provider mock that keeps calling a tool while tools are offered, and
 * answers in plain text once the turn is forced text-only (no tools sent).
 * Each call reads a distinct path so the repeat/stagnation loop detector
 * (MAX_IDENTICAL_TOOL_CALLS) never mistakes this deliberate loop for a stuck one.
 */
function mockRealisticToolLoopingProvider(toolCallIdPrefix: string) {
  let callIndex = 0;
  mockStreamMessage.mockImplementation((_messages: unknown, options: any) => {
    callIndex += 1;
    const toolsOffered = Array.isArray(options?.tools) && options.tools.length > 0;
    if (toolsOffered) {
      return createStreamGenerator(
        [
          {
            type: 'tool_call',
            toolCall: {
              id: `${toolCallIdPrefix}-${callIndex}`,
              name: 'read_file',
              arguments: JSON.stringify({ path: `test-${callIndex}.txt` }),
            },
          },
          { type: 'done', content: '' },
        ],
        'tool',
      );
    }
    return createStreamGenerator(
      [
        { type: 'token', content: 'Checkpoint summary.' },
        { type: 'done', content: 'Checkpoint summary.' },
      ],
      'text',
    );
  });
  return () => callIndex;
}

describe('Orchestrator foreground interaction budget', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('forces a checkpoint text turn at the foreground iteration ceiling with no error and a resumable status', async () => {
    const getCallCount = mockRealisticToolLoopingProvider('tc');
    (executeTool as jest.Mock).mockResolvedValue({ status: 'completed', content: 'ok' });

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider: makeProvider(),
      model: 'gpt-5.4',
      conversationId: 'conv-foreground-iteration-cap',
      systemPrompt: 'You are helpful',
      isForegroundRun: true,
      toolFilter: allowTools(['read_file']),
      messages: [
        { id: 'msg1', role: 'user', content: 'Keep working until told to stop.', timestamp: Date.now() },
      ],
    };

    const result = await runOrchestrator(options, callbacks);

    // 11 tool-calling turns, then the forced text-only checkpoint turn at
    // iteration FOREGROUND_MAX_TOOL_ITERATIONS.
    expect(getCallCount()).toBe(FOREGROUND_MAX_TOOL_ITERATIONS);
    const lastCallOptions = mockStreamMessage.mock.calls[mockStreamMessage.mock.calls.length - 1][1];
    expect(lastCallOptions.tools ?? []).toEqual([]);

    expect(callbacks.calls.onError).toHaveLength(0);
    expect(result.terminalDisposition).not.toBe('failed');
    const finalAssistant = callbacks.calls.onAssistantMessage.find(
      (entry) => entry.assistantMetadata?.kind === 'final',
    );
    expect(finalAssistant?.content).toContain('Checkpoint summary.');
  });

  it('does not cap a non-foreground run at the foreground iteration ceiling', async () => {
    const getCallCount = mockRealisticToolLoopingProvider('bg');
    (executeTool as jest.Mock).mockResolvedValue({ status: 'completed', content: 'ok' });

    // Stop looping shortly after the foreground ceiling so the run finishes on
    // a real final answer instead of relying on the (much higher) hard cap.
    const originalImplementation = mockStreamMessage.getMockImplementation();
    mockStreamMessage.mockImplementation((messages: unknown, options: any) => {
      if (getCallCount() >= FOREGROUND_MAX_TOOL_ITERATIONS + 3) {
        return createStreamGenerator(
          [
            { type: 'token', content: 'Finished after the foreground ceiling.' },
            { type: 'done', content: 'Finished after the foreground ceiling.' },
          ],
          'text',
        );
      }
      return originalImplementation!(messages, options);
    });

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider: makeProvider(),
      model: 'gpt-5.4',
      conversationId: 'conv-background-no-cap',
      systemPrompt: 'You are helpful',
      toolFilter: allowTools(['read_file']),
      messages: [
        { id: 'msg1', role: 'user', content: 'Keep working until told to stop.', timestamp: Date.now() },
      ],
    };

    const result = await runOrchestrator(options, callbacks);

    expect(getCallCount()).toBeGreaterThan(FOREGROUND_MAX_TOOL_ITERATIONS);
    // The call at the foreground ceiling still carried tools: nothing forced a
    // text-only turn there for a run that never set isForegroundRun.
    const ceilingCallOptions = mockStreamMessage.mock.calls[FOREGROUND_MAX_TOOL_ITERATIONS - 1][1];
    expect((ceilingCallOptions.tools ?? []).length).toBeGreaterThan(0);
    expect(callbacks.calls.onError).toHaveLength(0);
    expect(result.terminalDisposition).not.toBe('failed');
  });

  // The wall-clock trigger (elapsed time alone, independent of iteration count)
  // is covered with fake timers at the unit level in
  // foregroundRun/foregroundInteractionBudget.test.ts ("checkpoints once real
  // elapsed wall-clock time crosses the ceiling"). Reproducing that here would
  // require advancing fake timers past every real setTimeout the orchestrator
  // loop uses internally (e.g. yieldToUiFrame's frame-yield delay) without
  // tripping the model-turn inactivity guard, which is exactly the kind of
  // fragile, hang-prone setup the unit test avoids by testing the pure
  // decision function directly.
});
