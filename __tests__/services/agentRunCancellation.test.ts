import {
  __resetAgentRunCancellationRegistryForTests,
  cancelAgentRunOperations,
  clearAgentRunCancellation,
  createAgentRunOperationController,
  throwIfAbortSignalTriggered,
} from '../../src/services/agents/agentRunCancellation';

describe('agentRunCancellation', () => {
  beforeEach(() => {
    __resetAgentRunCancellationRegistryForTests();
  });

  afterEach(() => {
    __resetAgentRunCancellationRegistryForTests();
  });

  it('aborts registered operation controllers when the run is cancelled', () => {
    const operation = createAgentRunOperationController({
      conversationId: 'conv-1',
      runId: 'run-1',
      operationId: 'pilot-review',
    });

    expect(operation.signal.aborted).toBe(false);

    const abortReason = cancelAgentRunOperations('conv-1', 'run-1', 'Stopped by the user.');

    expect(abortReason).toMatchObject({
      name: 'AbortError',
      message: 'Stopped by the user.',
    });
    expect(operation.signal.aborted).toBe(true);
    expect(() => throwIfAbortSignalTriggered(operation.signal)).toThrow('Stopped by the user.');

    operation.dispose();
  });

  it('immediately aborts newly-created operations for cancelled runs', () => {
    cancelAgentRunOperations('conv-1', 'run-1', 'Pilot review cancelled.');

    const operation = createAgentRunOperationController({
      conversationId: 'conv-1',
      runId: 'run-1',
      operationId: 'final-response',
    });

    expect(operation.signal.aborted).toBe(true);
    expect(() => throwIfAbortSignalTriggered(operation.signal)).toThrow('Pilot review cancelled.');

    operation.dispose();
  });

  it('clears cancelled state so legitimate resumed work can proceed', () => {
    cancelAgentRunOperations('conv-1', 'run-1', 'Old cancellation state.');
    clearAgentRunCancellation('conv-1', 'run-1');

    const operation = createAgentRunOperationController({
      conversationId: 'conv-1',
      runId: 'run-1',
      operationId: 'async-resume',
    });

    expect(operation.signal.aborted).toBe(false);

    operation.dispose();
  });

  it('propagates parent-signal aborts into run-scoped operations', () => {
    const parentController = new AbortController();
    const operation = createAgentRunOperationController({
      conversationId: 'conv-1',
      runId: 'run-1',
      operationId: 'final-response',
      parentSignal: parentController.signal,
    });

    const parentAbortError = new Error('Foreground request cancelled.');
    parentAbortError.name = 'AbortError';
    parentController.abort(parentAbortError);

    expect(operation.signal.aborted).toBe(true);
    expect(() => throwIfAbortSignalTriggered(operation.signal)).toThrow(
      'Foreground request cancelled.',
    );

    operation.dispose();
  });
});
