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
    it('launchSubAgent returns before worker bootstrap begins', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      jest.useFakeTimers();
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const launched = await launchSubAgent(
        { parentConversationId: 'p', prompt: 'background task' },
        mockProvider,
      );

      expect(launched.status).toBe('running');
      expect(getSubAgent(launched.sessionId)?.launchState).toBe('queued');
      expect(runOrchestrator).not.toHaveBeenCalled();

      await jest.runOnlyPendingTimersAsync();

      expect(runOrchestrator).toHaveBeenCalledTimes(1);
    });

    it('startSubAgent keeps a waitable resultPromise while deferring worker bootstrap', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      jest.useFakeTimers();
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onToken?.('deferred output');
        callbacks.onDone?.();
        return Promise.resolve();
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

    it('fails a deferred worker that never bootstraps and preserves launch diagnostics', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      jest.useFakeTimers();
      const originalSetTimeout = global.setTimeout;
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((
        handler: TimerHandler,
        timeout?: number,
        ...args: any[]
      ) => {
        if ((timeout ?? 0) === 0) {
          return 999999 as any;
        }
        return originalSetTimeout(handler as any, timeout as any, ...args) as any;
      }) as typeof setTimeout);

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
          error: expect.stringContaining('stalled before bootstrapping'),
        });
        expect(getSubAgent(started.sessionId)?.launchState).toBe('terminal');
        expect(runOrchestrator).not.toHaveBeenCalled();
      } finally {
        setTimeoutSpy.mockRestore();
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

      await jest.runOnlyPendingTimersAsync();

      expect(runOrchestrator).not.toHaveBeenCalled();
      expect(getSubAgent(launched.sessionId)?.status).toBe('cancelled');
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
