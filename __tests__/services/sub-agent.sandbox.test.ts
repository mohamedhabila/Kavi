import {
  getSubAgent,
  installSubAgentTestHarness,
  mockProvider,
  spawnSubAgent,
} from '../helpers/subAgentHarness';

describe('Sub-Agent Service', () => {
  installSubAgentTestHarness();

  describe('spawnSubAgent — sandbox enforcement', () => {
    it('passes toolFilter for safe-only sandbox policy', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedOptions: any = null;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedOptions = opts;
        callbacks.onToken?.('sandbox output');
        callbacks.onDone?.();
        return Promise.resolve();
      });

      await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'sandbox task',
          sandboxPolicy: 'safe-only',
        },
        mockProvider,
      );

      expect(capturedOptions).toBeDefined();
      expect(typeof capturedOptions.toolFilter).toBe('function');
    });

    it('does not pass toolFilter for full sandbox policy', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedOptions: any = null;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedOptions = opts;
        callbacks.onToken?.('full output');
        callbacks.onDone?.();
        return Promise.resolve();
      });

      await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'full access',
          sandboxPolicy: 'full',
        },
        mockProvider,
      );

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.toolFilter).toBeUndefined();
    });

    it('does not pass toolFilter for inherit sandbox policy', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedOptions: any = null;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedOptions = opts;
        callbacks.onToken?.('inherit output');
        callbacks.onDone?.();
        return Promise.resolve();
      });

      await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'inherit',
          sandboxPolicy: 'inherit',
        },
        mockProvider,
      );

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.toolFilter).toBeUndefined();
    });

    it('treats an explicit empty worker tools list as a no-tools whitelist', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedOptions: any = null;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedOptions = opts;
        callbacks.onToken?.('direct output');
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'return direct token',
          tools: [],
        },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(capturedOptions).toBeDefined();
      expect(typeof capturedOptions.toolFilter).toBe('function');
      expect(capturedOptions.toolFilter('read_workflow_evidence')).toBe(false);
      expect(capturedOptions.toolFilter('record_workflow_evidence')).toBe(false);
      expect(capturedOptions.toolFilter('python')).toBe(false);
    });

    it('requires scoped execution units for worker graph planning', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedOptions: any = null;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedOptions = opts;
        callbacks.onToken?.('worker output');
        callbacks.onDone?.();
        return Promise.resolve();
      });

      await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'Read a file and summarize it.',
          tools: ['read_file'],
        },
        mockProvider,
      );

      expect(capturedOptions).toEqual(
        expect.objectContaining({
          toolFilter: expect.any(Function),
        }),
      );
      expect(capturedOptions.toolFilter('read_file')).toBe(true);
      expect(capturedOptions.toolFilter('write_file')).toBe(false);
    });

    it('stores a worker-owned task ledger from the worker graph state', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      const {
        createInitialAgentControlGraphSnapshot,
      } = require('../../src/engine/graph/agentControlGraph');
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAgentControlGraphStateChange?.(
          createInitialAgentControlGraphSnapshot({
            goals: [
              {
                id: 'worker-read',
                title: 'Read scoped worker input',
                status: 'active',
                owner: 'worker',
                dependencies: [],
                evidence: [],
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
            ],
          }),
        );
        callbacks.onToken?.('worker output');
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'Read the delegated input.',
          tools: ['read_file'],
        },
        mockProvider,
      );

      const snapshot = getSubAgent(result.sessionId);
      expect(snapshot?.taskLedger).toEqual([
        expect.objectContaining({
          id: 'worker-read',
          status: 'active',
          owner: 'worker',
          title: 'Read scoped worker input',
        }),
      ]);
    });

    it('treats an explicit empty serialized worker tools list as a no-tools whitelist', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedOptions: any = null;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedOptions = opts;
        callbacks.onToken?.('direct output');
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'return direct token',
          tools: '[]',
        },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(capturedOptions).toBeDefined();
      expect(typeof capturedOptions.toolFilter).toBe('function');
      expect(capturedOptions.toolFilter('web_search')).toBe(false);
    });

    it('safe-only toolFilter blocks non-safe tools', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedFilter: ((name: string) => boolean) | undefined;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedFilter = opts.toolFilter;
        callbacks.onDone?.();
        return Promise.resolve();
      });

      await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'safe only',
          sandboxPolicy: 'safe-only',
        },
        mockProvider,
      );

      // Safe tools should pass
      expect(capturedFilter!('web_search')).toBe(true);
      expect(capturedFilter!('web_fetch')).toBe(true);
      expect(capturedFilter!('glob_search')).toBe(true);
      expect(capturedFilter!('text_search')).toBe(true);
      expect(capturedFilter!('sessions_status')).toBe(true);
      expect(capturedFilter!('sessions_output')).toBe(true);
      expect(capturedFilter!('sessions_wait')).toBe(true);
      expect(capturedFilter!('expo_eas_status')).toBe(true);
      // Dangerous tools should be blocked
      expect(capturedFilter!('execute_command')).toBe(false);
      expect(capturedFilter!('write_file')).toBe(false);
    });

    it('treats configured worker tools as exact names before applying the sandbox filter', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedOptions: any = null;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedOptions = opts;
        callbacks.onDone?.();
        return Promise.resolve();
      });

      await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'exact tools',
          tools: ['read_file', 'web_search'],
          sandboxPolicy: 'safe-only',
        },
        mockProvider,
      );

      expect(capturedOptions.toolFilter('read_file')).toBe(true);
      expect(capturedOptions.toolFilter('web_search')).toBe(true);
      expect(capturedOptions.toolFilter('ReadFile')).toBe(false);
      expect(capturedOptions.toolFilter('write_file')).toBe(false);
    });

    it('fails fast when explicit worker tools are incompatible with the safe-only sandbox', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'write a file',
          tools: ['write_file'],
          sandboxPolicy: 'safe-only',
        },
        mockProvider,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('not allowed by the safe-only sandbox');
      expect(runOrchestrator).not.toHaveBeenCalled();
    });

    it('fails fast when explicit worker tools are currently unavailable at runtime', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'fix the repo files',
          tools: ['workspace_launch_browser'],
        },
        mockProvider,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('currently available');
      expect(runOrchestrator).not.toHaveBeenCalled();
    });
  });
});
