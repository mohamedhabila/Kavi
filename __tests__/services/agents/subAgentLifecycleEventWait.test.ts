import type { SubAgentResult, SubAgentSnapshot } from '../../../src/types/subAgent';
import {
  createSubAgentLifecycleManager,
  waitForSubAgentResultPromise,
} from '../../../src/services/agents/lifecycle/lifecycleManager';
import {
  createSubAgentRuntimeSignalsManager,
  type SubAgentTerminalEvent,
} from '../../../src/services/agents/subAgentRuntimeSignals';

function makeAgent(sessionId = 'worker-1'): SubAgentSnapshot {
  return {
    sessionId,
    parentConversationId: 'parent-1',
    depth: 0,
    startedAt: 1,
    updatedAt: 1,
    status: 'running',
    sandboxPolicy: 'safe-only',
    launchState: 'active',
  };
}

function createHarness(options?: { terminalizeDuringSubscription?: boolean }) {
  const agent = makeAgent();
  const activeSubAgents = new Map([[agent.sessionId, agent]]);
  const activeResultPromises = new Map<string, Promise<SubAgentResult>>();
  const activeRunControls = new Map<string, any>();
  const terminalListeners = new Set<
    (snapshot: SubAgentSnapshot, event: SubAgentTerminalEvent) => void
  >();

  const emitTerminal = (snapshot: SubAgentSnapshot, event: SubAgentTerminalEvent): void => {
    for (const listener of terminalListeners) {
      listener({ ...snapshot }, event);
    }
  };

  const manager = createSubAgentLifecycleManager({
    activeSubAgents,
    activeRunControls,
    activeResultPromises,
    logger: { devWarn: jest.fn() },
    registryPersistenceManager: {
      loadRegistry: jest.fn(async () => undefined),
      persistRegistryNow: jest.fn(async () => undefined),
      scheduleRegistryPersist: jest.fn(),
    },
    sessionContextManager: {
      deleteSessionContext: jest.fn(),
      scheduleSessionContextEviction: jest.fn(),
    },
    clearQueuedLaunchWatch: jest.fn(),
    clearScheduledProgressAnnouncement: jest.fn(),
    resolveScheduledLaunchWithSnapshot: jest.fn(() => false),
    cloneAgent: (snapshot) => ({ ...snapshot }),
    updateAgentProgress: (snapshot, changes) => Object.assign(snapshot, changes),
    appendActivity: jest.fn(),
    onSubAgentTerminal: (listener) => {
      terminalListeners.add(listener);
      if (options?.terminalizeDuringSubscription) {
        agent.status = 'completed';
        agent.output = 'completed during listener registration';
      }
      return () => {
        terminalListeners.delete(listener);
      };
    },
    signalTerminal: (snapshot, event) => emitTerminal(snapshot, event),
    normalizePreviewText: (value) => value,
    maxToolResultPreviewChars: 320,
    terminalSubAgentRetentionMs: 60_000,
  });

  return {
    activeSubAgents,
    activeResultPromises,
    activeRunControls,
    agent,
    emitTerminal,
    manager,
    terminalListeners,
  };
}

describe('event-driven sub-agent completion waits', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('waits without periodic timers and wakes immediately on the exact terminal signal', async () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const harness = createHarness();

    const waiting = harness.manager.waitForSubAgentCompletion(harness.agent.sessionId);

    expect(harness.terminalListeners.size).toBe(1);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);

    harness.emitTerminal(harness.agent, 'completed');
    expect(harness.terminalListeners.size).toBe(1);

    harness.agent.status = 'completed';
    harness.agent.output = 'done';
    harness.agent.iterations = 3;
    harness.emitTerminal(harness.agent, 'completed');

    await expect(waiting).resolves.toMatchObject({
      sessionId: harness.agent.sessionId,
      status: 'completed',
      output: 'done',
      iterations: 3,
    });
    expect(harness.terminalListeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('uses one deadline timer, returns null at the deadline, and disposes its listener', async () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const harness = createHarness();

    const waiting = harness.manager.waitForSubAgentCompletion(harness.agent.sessionId, 1_000);

    expect(harness.terminalListeners.size).toBe(1);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 1_000);
    expect(jest.getTimerCount()).toBe(1);

    await jest.advanceTimersByTimeAsync(999);
    expect(harness.terminalListeners.size).toBe(1);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    await expect(waiting).resolves.toBeNull();
    expect(harness.terminalListeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('wakes cancellation waiters synchronously and returns the cancelled snapshot', async () => {
    jest.useFakeTimers();
    const harness = createHarness();
    const waiting = harness.manager.waitForSubAgentCompletion(harness.agent.sessionId, 10_000);

    harness.manager.cancelSubAgent(harness.agent.sessionId, 'Supervisor stopped this worker.');

    await expect(waiting).resolves.toMatchObject({
      status: 'cancelled',
      output: 'Supervisor stopped this worker.',
    });
    expect(harness.terminalListeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('wakes cancellation waiters even when an active provider promise ignores abort', async () => {
    jest.useFakeTimers();
    const harness = createHarness();
    const abortController = new AbortController();
    harness.activeRunControls.set(harness.agent.sessionId, { abortController });
    harness.activeResultPromises.set(
      harness.agent.sessionId,
      new Promise<SubAgentResult>(() => undefined),
    );
    const waiting = harness.manager.waitForSubAgentCompletion(harness.agent.sessionId, 10_000);

    harness.manager.cancelSubAgent(harness.agent.sessionId, 'Provider did not settle.');

    await expect(waiting).resolves.toMatchObject({
      status: 'cancelled',
      output: 'Provider did not settle.',
      terminationCause: 'cancelled',
    });
    expect(abortController.signal.aborted).toBe(true);
    expect(harness.agent.status).toBe('cancelled');
    expect(harness.terminalListeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('releases an active completion wait when the foreground execution is aborted', async () => {
    jest.useFakeTimers();
    const harness = createHarness();
    const foregroundController = new AbortController();
    harness.activeResultPromises.set(
      harness.agent.sessionId,
      new Promise<SubAgentResult>(() => undefined),
    );

    const waiting = harness.manager.waitForSubAgentCompletion(
      harness.agent.sessionId,
      300_000,
      foregroundController.signal,
    );
    expect(harness.terminalListeners.size).toBe(1);
    expect(jest.getTimerCount()).toBe(1);

    foregroundController.abort('Foreground turn timed out.');

    await expect(waiting).resolves.toBeNull();
    expect(harness.agent.status).toBe('running');
    expect(harness.terminalListeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('releases a started-worker result race on abort without cancelling the worker promise', async () => {
    jest.useFakeTimers();
    const foregroundController = new AbortController();
    const workerResult = new Promise<SubAgentResult>(() => undefined);

    const waiting = waitForSubAgentResultPromise(
      workerResult,
      300_000,
      foregroundController.signal,
    );
    expect(jest.getTimerCount()).toBe(1);

    foregroundController.abort('Foreground turn timed out.');

    await expect(waiting).resolves.toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('closes the subscribe/recheck race without waiting for another event', async () => {
    const harness = createHarness({ terminalizeDuringSubscription: true });

    await expect(
      harness.manager.waitForSubAgentCompletion(harness.agent.sessionId, 10_000),
    ).resolves.toMatchObject({
      status: 'completed',
      output: 'completed during listener registration',
    });
    expect(harness.terminalListeners.size).toBe(0);
  });

  it('waits for an active run promise even after its snapshot first appears terminal', async () => {
    const harness = createHarness();
    harness.agent.status = 'completed';
    harness.agent.output = 'snapshot before durable finalization';
    let resolveResult: ((result: SubAgentResult) => void) | undefined;
    const resultPromise = new Promise<SubAgentResult>((resolve) => {
      resolveResult = resolve;
    });
    harness.activeResultPromises.set(harness.agent.sessionId, resultPromise);
    let didSettle = false;

    const waiting = harness.manager
      .waitForSubAgentCompletion(harness.agent.sessionId)
      .then((result) => {
        didSettle = true;
        return result;
      });
    await Promise.resolve();

    expect(didSettle).toBe(false);
    expect(harness.terminalListeners.size).toBe(1);

    resolveResult?.({
      sessionId: harness.agent.sessionId,
      output: 'durably finalized output',
      toolsUsed: ['write_file'],
      iterations: 2,
      status: 'completed',
      depth: 1,
    });

    await expect(waiting).resolves.toMatchObject({
      output: 'durably finalized output',
      status: 'completed',
    });
    expect(harness.terminalListeners.size).toBe(0);
  });
});

describe('internal sub-agent terminal signals', () => {
  it('notifies lifecycle waiters when public announcements are disabled', () => {
    const agent = makeAgent();
    agent.status = 'completed';
    const signals = createSubAgentRuntimeSignalsManager({
      activeSubAgents: new Map([[agent.sessionId, agent]]),
      scheduledSubAgentLaunches: new Map(),
      cloneAgent: (snapshot) => ({ ...snapshot }),
      buildResultFromSnapshot: jest.fn(),
      updateAgentProgress: jest.fn(),
      appendActivity: jest.fn(),
      normalizePreviewText: (value) => value,
      scheduleRegistryPersist: jest.fn(),
      maxToolResultPreviewChars: 320,
      queuedLaunchWarningMs: 2_000,
      queuedLaunchTimeoutMs: 20_000,
      progressAnnounceIntervalMs: 250,
    });
    const publicListener = jest.fn();
    const terminalListener = jest.fn();
    signals.onSubAgentEvent(publicListener);
    const unsubscribeTerminal = signals.onSubAgentTerminal(terminalListener);

    signals.signalTerminal(agent, 'completed', { announce: false });

    expect(terminalListener).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: agent.sessionId, status: 'completed' }),
      'completed',
    );
    expect(publicListener).not.toHaveBeenCalled();

    unsubscribeTerminal();
    signals.signalTerminal(agent, 'completed', { announce: false });
    expect(terminalListener).toHaveBeenCalledTimes(1);
  });
});
