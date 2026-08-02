import {
  cancelActiveAndroidLongHorizonWork,
  runAndroidLongHorizonKeepAliveTask,
  withAndroidLongHorizonExecutionLease,
} from '../../src/services/androidLongHorizonExecution';

describe('Android long-horizon execution', () => {
  const result = (
    status: 'accepted' | 'no_op' | 'released' | 'missing' | 'unavailable',
    activeLeaseCount: number,
    reason:
      | 'foreground_service_start_not_allowed'
      | 'foreground_service_permission_missing'
      | 'foreground_service_start_failed'
      | null = null,
  ) => ({ schema: 1, status, reason, activeLeaseCount });

  function harness(acquireResult = result('accepted', 1)) {
    const native = {
      bridgeSchema: 1,
      cancelEventName: 'KaviLongHorizonCancelRequested',
      keepAliveTaskKey: 'KaviLongHorizonExecutionKeepAlive',
      acquire: jest.fn().mockResolvedValue(acquireResult),
      release: jest.fn().mockResolvedValue(result('released', 0)),
      getStatus: jest.fn(),
      awaitIdle: jest.fn().mockResolvedValue({ schema: 1, status: 'idle', activeLeaseCount: 0 }),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    const warn = jest.fn();
    return {
      native,
      warn,
      dependencies: {
        platform: 'android',
        getNativeModule: () => native,
        warn,
      },
    };
  }

  it('holds one native lease around successful and failed work', async () => {
    const success = harness();
    await expect(
      withAndroidLongHorizonExecutionLease(
        { leaseId: 'chat:request-1', taskKind: 'chat' },
        async () => 'done',
        success.dependencies,
      ),
    ).resolves.toBe('done');
    expect(success.native.acquire).toHaveBeenCalledWith('chat:request-1', 'chat');
    expect(success.native.release).toHaveBeenCalledWith('chat:request-1');

    const failure = harness();
    const taskError = new Error('task failed');
    await expect(
      withAndroidLongHorizonExecutionLease(
        { leaseId: 'sub-agent:worker-1', taskKind: 'sub_agent' },
        async () => {
          throw taskError;
        },
        failure.dependencies,
      ),
    ).rejects.toBe(taskError);
    expect(failure.native.release).toHaveBeenCalledWith('sub-agent:worker-1');
  });

  it('continues without claiming ownership when Android cannot start the service', async () => {
    const context = harness(result('unavailable', 0, 'foreground_service_start_not_allowed'));
    const operation = jest.fn().mockResolvedValue('continued');

    await expect(
      withAndroidLongHorizonExecutionLease(
        { leaseId: 'chat:request-2', taskKind: 'chat' },
        operation,
        context.dependencies,
      ),
    ).resolves.toBe('continued');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(context.native.release).not.toHaveBeenCalled();
    expect(context.warn).toHaveBeenCalledWith(
      expect.stringContaining('foreground_service_start_not_allowed'),
    );
  });

  it('is a transparent no-op off Android or when the optional bridge is absent', async () => {
    const operation = jest.fn().mockResolvedValue('done');
    await expect(
      withAndroidLongHorizonExecutionLease(
        { leaseId: 'chat:request-3', taskKind: 'chat' },
        operation,
        { platform: 'ios', getNativeModule: () => null, warn: jest.fn() },
      ),
    ).resolves.toBe('done');
    await expect(
      withAndroidLongHorizonExecutionLease(
        { leaseId: 'chat:request-4', taskKind: 'chat' },
        operation,
        { platform: 'android', getNativeModule: () => null, warn: jest.fn() },
      ),
    ).resolves.toBe('done');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('keeps the Android headless task pending until native leases become idle', async () => {
    const context = harness();
    let resolveIdle!: (value: unknown) => void;
    context.native.awaitIdle.mockReturnValue(
      new Promise((resolve) => {
        resolveIdle = resolve;
      }),
    );
    let settled = false;
    const pending = runAndroidLongHorizonKeepAliveTask({ schema: 1 }, context.dependencies).then(
      () => {
        settled = true;
      },
    );

    await Promise.resolve();
    expect(context.native.awaitIdle).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    resolveIdle({ schema: 1, status: 'idle', activeLeaseCount: 0 });
    await pending;
    expect(settled).toBe(true);
  });

  it('fails closed on malformed headless payloads and idle bridge results', async () => {
    const context = harness();
    await expect(
      runAndroidLongHorizonKeepAliveTask({ schema: 1, extra: true }, context.dependencies),
    ).rejects.toThrow('android-long-horizon-keep-alive-payload-invalid');

    context.native.awaitIdle.mockResolvedValue({ schema: 1, status: 'idle', activeLeaseCount: 1 });
    await expect(
      runAndroidLongHorizonKeepAliveTask({ schema: 1 }, context.dependencies),
    ).rejects.toThrow('android-long-horizon-idle-contract-violation');
  });

  it('cancels every active chat and worker from the notification action', () => {
    const abortForegroundConversation = jest.fn(() => true);
    const clearForegroundConversation = jest.fn(() => true);
    const terminalizeForegroundConversation = jest.fn();
    const cancelSubAgent = jest.fn(() => ({ status: 'cancelled' }));
    const flushSubAgentState = jest.fn().mockResolvedValue(undefined);

    expect(
      cancelActiveAndroidLongHorizonWork({
        activeForegroundConversationIds: () => ['conversation-1', 'conversation-2'],
        abortForegroundConversation,
        clearForegroundConversation,
        terminalizeForegroundConversation,
        activeSubAgentIds: () => ['worker-1', 'worker-2'],
        cancelSubAgent,
        flushSubAgentState,
      }),
    ).toEqual({ foregroundRequests: 2, subAgents: 2 });
    expect(abortForegroundConversation).toHaveBeenCalledTimes(2);
    expect(clearForegroundConversation).toHaveBeenCalledTimes(2);
    expect(terminalizeForegroundConversation).toHaveBeenCalledTimes(2);
    expect(cancelSubAgent).toHaveBeenCalledTimes(2);
    expect(flushSubAgentState).toHaveBeenCalledTimes(1);
    expect(abortForegroundConversation).toHaveBeenCalledWith(
      'conversation-1',
      'Stopped from the Android background-task notification.',
    );
    expect(terminalizeForegroundConversation).toHaveBeenCalledWith('conversation-1');
  });

  it('distinguishes platform continuity loss from a user notification stop', () => {
    const abortForegroundConversation = jest.fn(() => true);
    cancelActiveAndroidLongHorizonWork(
      {
        activeForegroundConversationIds: () => ['conversation-1'],
        abortForegroundConversation,
        clearForegroundConversation: jest.fn(() => true),
        terminalizeForegroundConversation: jest.fn(),
        activeSubAgentIds: () => [],
        cancelSubAgent: jest.fn(),
      },
      'background_continuity_unavailable',
    );

    expect(abortForegroundConversation).toHaveBeenCalledWith(
      'conversation-1',
      'Android could not keep this task running reliably in the background.',
    );
  });
});
