import { resolveAgentControlGraphToolExecutionOutcomes } from '../../src/engine/graph/toolExecutionOutcomeResolution';
import { buildBaseParams, createToolMessage } from '../helpers/toolExecutionOutcomeHarness';

describe('tool execution outcome resolution', () => {
  it('finalizes yielded tool turns through the graph terminal event', async () => {
    const params = buildBaseParams();
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc3',
        toolMessage: createToolMessage({
          id: 'tc3',
          name: 'sessions_wait',
          content: '{"status":"checkpointed"}',
        }),
        yieldedMessage: 'Checkpoint now',
      },
    ];

    const result = await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(result).toEqual(
      expect.objectContaining({
        status: 'finalized',
      }),
    );
    expect(params.finishWithGraphTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        graphEvent: {
          type: 'YIELDED',
          reason: 'tool_yielded',
        },
        content: 'Checkpoint now',
        sessionEndReason: 'yielded',
      }),
    );
    expect(params.onStateChange).not.toHaveBeenCalledWith('thinking');
  });
});
