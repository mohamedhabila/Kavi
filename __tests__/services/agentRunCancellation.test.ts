import {
  __resetAgentRunCancellationRegistryForTests,
  cancelAgentRunOperations,
  clearAgentRunCancellation,
  createAgentRunOperationController,
  isAbortErrorLike,
  throwIfAbortSignalTriggered,
} from '../../src/services/agents/agentRunCancellation';
import {
  AGENT_RUNTIME_ERROR_CODES,
  createAgentRunAbortError,
  isAgentRuntimeErrorCode,
} from '../../src/services/runtimeError';

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
      code: AGENT_RUNTIME_ERROR_CODES.AGENT_RUN_ABORTED,
      message: 'Stopped by the user.',
    });
    expect(isAgentRuntimeErrorCode(abortReason, AGENT_RUNTIME_ERROR_CODES.AGENT_RUN_ABORTED)).toBe(
      true,
    );
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
    expect(
      isAgentRuntimeErrorCode(operation.signal.reason, AGENT_RUNTIME_ERROR_CODES.AGENT_RUN_ABORTED),
    ).toBe(true);
    expect((operation.signal.reason as Error & { cause?: unknown }).cause).toBe(parentAbortError);
    expect(() => throwIfAbortSignalTriggered(operation.signal)).toThrow(
      'Foreground request cancelled.',
    );

    operation.dispose();
  });

  it('classifies cancellation only from owned error codes or an aborted signal', () => {
    const messageOnlyError = new Error('Request cancelled');
    const nameOnlyError = Object.assign(new Error('Transport stopped.'), {
      name: 'AbortError',
    });
    const typedAbort = createAgentRunAbortError('Network request failed');

    expect(isAbortErrorLike(messageOnlyError)).toBe(false);
    expect(isAbortErrorLike(nameOnlyError)).toBe(false);
    expect(isAbortErrorLike(typedAbort)).toBe(true);

    const controller = new AbortController();
    controller.abort(new Error('User stopped the run.'));
    expect(isAbortErrorLike(new Error('Unrelated provider failure.'), controller.signal)).toBe(
      true,
    );
  });
});
