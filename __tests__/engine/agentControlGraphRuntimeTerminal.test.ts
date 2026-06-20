import { createAgentControlGraphRuntimeTerminal } from '../../src/engine/graph/agentControlGraphRuntimeTerminal';
import { emitSessionEvent } from '../../src/services/events/bus';

jest.mock('../../src/services/events/bus', () => ({
  emitSessionEvent: jest.fn().mockResolvedValue(undefined),
}));

const mockedEmitSessionEvent = jest.mocked(emitSessionEvent);

describe('agentControlGraphRuntimeTerminal', () => {
  beforeEach(() => {
    mockedEmitSessionEvent.mockReset();
    mockedEmitSessionEvent.mockResolvedValue(undefined);
  });

  it('warns and still completes failure callbacks when the terminal end event fails', async () => {
    const endEventError = new Error('event bus unavailable');
    const originalError = new Error('primary failure');
    mockedEmitSessionEvent.mockRejectedValueOnce(endEventError);
    const callbacks = {
      onAgentControlGraphStateChange: jest.fn(),
      onAssistantMessage: jest.fn(),
      onStateChange: jest.fn(),
      onError: jest.fn(),
      onDone: jest.fn(),
    };
    const warn = jest.fn();
    const applyEvents = jest.fn().mockReturnValue({ status: 'failed' });

    const terminal = createAgentControlGraphRuntimeTerminal({
      callbacks,
      conversationId: 'conv-1',
      applyEvents,
      warn,
    });

    await terminal.finishFailure(originalError);

    expect(applyEvents).toHaveBeenCalledWith([{ type: 'FAILED', reason: 'primary failure' }]);
    expect(callbacks.onStateChange).toHaveBeenCalledWith('error');
    expect(mockedEmitSessionEvent).toHaveBeenCalledWith('end', {
      conversationId: 'conv-1',
      reason: 'error',
    });
    expect(warn).toHaveBeenCalledWith(
      'Agent control graph terminal session end event failed',
      endEventError,
    );
    expect(callbacks.onError).toHaveBeenCalledWith(originalError);
    expect(callbacks.onDone).toHaveBeenCalledTimes(1);
  });
});
