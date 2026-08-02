import {
  cancelSubAgent,
  cleanupSubAgents,
  getSubAgent,
  installSubAgentTestHarness,
  launchSubAgent,
  listActiveSubAgents,
  mockProvider,
  spawnSubAgent,
  startSubAgent,
} from '../helpers/subAgentHarness';

describe('Sub-Agent Service', () => {
  installSubAgentTestHarness();

  describe('spawnSubAgent', () => {
    it('starts worker bootstrap without depending on a zero-delay timer', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
      let releaseRun: (() => void) | undefined;
      runOrchestrator.mockImplementationOnce(
        (_opts: any, callbacks: any) =>
          new Promise((resolve) => {
            releaseRun = () => {
              callbacks.onDone?.();
              resolve({ terminalDisposition: 'final_candidate' });
            };
          }),
      );
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      try {
        const started = await startSubAgent(
          { parentConversationId: 'p', prompt: 'background task' },
          mockProvider,
        );

        expect(started.status).toBe('running');
        expect(runOrchestrator).toHaveBeenCalledTimes(1);
        expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 0)).toBe(false);

        releaseRun?.();
        await started.resultPromise;
      } finally {
        setTimeoutSpy.mockRestore();
      }
    });

    it('startSubAgent keeps a waitable resultPromise while worker bootstrap is scheduled', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      jest.useFakeTimers();
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onToken?.('deferred output');
        callbacks.onDone?.();
        return Promise.resolve({ terminalDisposition: 'final_candidate' });
      });

      const started = await startSubAgent(
        { parentConversationId: 'p', prompt: 'waitable task' },
        mockProvider,
      );

      expect(started.status).toBe('running');
      expect(runOrchestrator).not.toHaveBeenCalled();

      await jest.runOnlyPendingTimersAsync();

      await expect(started.resultPromise).resolves.toMatchObject({
        status: 'completed',
        output: 'deferred output',
      });
    });

    it('updates worker activity during bootstrap before the first token arrives', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      jest.useFakeTimers();
      let releaseRun: (() => void) | undefined;
      runOrchestrator.mockImplementationOnce(
        (_opts: any, callbacks: any) =>
          new Promise<void>((resolve) => {
            callbacks.onStateChange?.('thinking');
            releaseRun = () => {
              callbacks.onDone?.();
              resolve();
            };
          }),
      );

      const started = await startSubAgent(
        { parentConversationId: 'p', prompt: 'plan before speaking' },
        mockProvider,
      );

      expect(getSubAgent(started.sessionId)?.currentActivity).toBe('Queued to start');
      expect(getSubAgent(started.sessionId)?.launchState).toBe('queued');

      await jest.runOnlyPendingTimersAsync();

      expect(getSubAgent(started.sessionId)?.currentActivity).toBe('Planning task');
      expect(getSubAgent(started.sessionId)?.launchState).toBe('active');

      releaseRun?.();
      await started.resultPromise;
    });

    it('replaces generic responding activity with streamed worker output once tokens arrive', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      jest.useFakeTimers();
      let releaseRun: (() => void) | undefined;
      const streamedText = `${'Initial setup details. '.repeat(24)}Tail marker: streaming concrete worker output.`;
      runOrchestrator.mockImplementationOnce(
        (_opts: any, callbacks: any) =>
          new Promise<void>((resolve) => {
            callbacks.onStateChange?.('responding');
            callbacks.onToken?.(streamedText);
            releaseRun = () => {
              callbacks.onDone?.();
              resolve();
            };
          }),
      );

      const started = await startSubAgent(
        { parentConversationId: 'p', prompt: 'stream visible worker text' },
        mockProvider,
      );

      await jest.runOnlyPendingTimersAsync();

      expect(getSubAgent(started.sessionId)?.currentActivity).toContain(
        'Tail marker: streaming concrete worker out',
      );
      expect(getSubAgent(started.sessionId)?.currentActivity).not.toBe(
        'Preparing initial response',
      );

      releaseRun?.();
      await started.resultPromise;
    });

    it('fails a queued worker when even its microtask launch boundary never executes', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      jest.useFakeTimers();
      const queueMicrotaskSpy = jest
        .spyOn(global, 'queueMicrotask')
        .mockImplementation(() => undefined);

      try {
        const started = await startSubAgent(
          { parentConversationId: 'p', prompt: 'stalled launch' },
          mockProvider,
        );

        expect(getSubAgent(started.sessionId)?.launchState).toBe('queued');

        await jest.advanceTimersByTimeAsync(2_000);
        expect(getSubAgent(started.sessionId)?.currentActivity).toBe(
          'Still starting worker runtime',
        );
        expect(getSubAgent(started.sessionId)?.launchState).toBe('queued');

        await jest.advanceTimersByTimeAsync(18_000);

        await expect(started.resultPromise).resolves.toMatchObject({
          status: 'error',
          terminationCause: 'internal_failure',
          error: expect.stringContaining('stalled before bootstrapping'),
        });
        expect(getSubAgent(started.sessionId)?.launchState).toBe('terminal');
        expect(runOrchestrator).not.toHaveBeenCalled();
      } finally {
        queueMicrotaskSpy.mockRestore();
      }
    });

    it('does not bootstrap a deferred worker after pre-start cancellation', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      jest.useFakeTimers();
      runOrchestrator.mockImplementationOnce(() => {
        throw new Error('worker should not start');
      });

      const launched = await launchSubAgent(
        { parentConversationId: 'p', prompt: 'cancel me early' },
        mockProvider,
      );

      const cancelled = cancelSubAgent(launched.sessionId, 'Stop before bootstrap');
      expect(cancelled?.status).toBe('cancelled');
      expect(cancelled?.terminationCause).toBe('cancelled');

      await jest.runOnlyPendingTimersAsync();

      expect(runOrchestrator).not.toHaveBeenCalled();
      expect(getSubAgent(launched.sessionId)?.status).toBe('cancelled');
      expect(getSubAgent(launched.sessionId)?.terminationCause).toBe('cancelled');
    });
  });

  describe('listActiveSubAgents', () => {
    it('lists spawned sub-agents', async () => {
      await spawnSubAgent({ parentConversationId: 'p', prompt: 'task' }, mockProvider);
      const agents = listActiveSubAgents();
      expect(agents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getSubAgent', () => {
    it('returns sub-agent by ID', async () => {
      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'task' },
        mockProvider,
      );
      const agent = getSubAgent(result.sessionId);
      expect(agent).toBeDefined();
    });

    it('returns undefined for unknown ID', () => {
      expect(getSubAgent('unknown-id-that-does-not-exist')).toBeUndefined();
    });
  });

  describe('cleanupSubAgents', () => {
    it('does not throw', () => {
      expect(() => cleanupSubAgents()).not.toThrow();
    });
  });
});
