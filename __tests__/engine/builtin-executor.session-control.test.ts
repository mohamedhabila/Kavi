import {
  executeSessionCancel,
  executeSessionHistory,
  executeSessionOutput,
  executeSessionStatus,
  executeSessionYield,
  installBuiltinExecutorRuntimeReset,
} from '../helpers/builtinExecutorRuntimeHarness';

describe('builtin executor session control', () => {
  installBuiltinExecutorRuntimeReset();

  describe('executeSessionHistory', () => {
    it('returns error for non-existent session', async () => {
      const result = await executeSessionHistory({ sessionId: 'none' });
      expect(result).toContain('Error');
      expect(result).toContain('session not found');
    });

    it('returns history for existing session', async () => {
      const { getSubAgent } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        sessionId: 'sub-1',
        status: 'completed',
        startedAt: 1000,
        output: 'Hello from sub-agent',
      });

      const result = await executeSessionHistory({ sessionId: 'sub-1' });
      const parsed = JSON.parse(result);
      expect(parsed.sessionId).toBe('sub-1');
      expect(parsed.status).toBe('completed');
      expect(parsed.messages).toHaveLength(1);
      expect(parsed.messages[0].content).toBe('Hello from sub-agent');
    });
  });


  describe('executeSessionStatus', () => {
    it('returns error for non-existent session', async () => {
      const result = await executeSessionStatus({ sessionId: 'none' });
      expect(result).toContain('Error');
    });

    it('returns status for existing session', async () => {
      const { getSubAgent } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        sessionId: 'sub-1',
        status: 'running',
        startedAt: Date.now() - 5000,
        output: 'In progress...',
        currentActivity: 'Reading repository files',
        activeToolName: 'read_file',
      });

      const result = await executeSessionStatus({ sessionId: 'sub-1' });
      const parsed = JSON.parse(result);
      expect(parsed.sessionId).toBe('sub-1');
      expect(parsed.status).toBe('running');
      expect(parsed.hasOutput).toBe(true);
      expect(parsed.currentActivity).toBe('Reading repository files');
      expect(parsed.activeToolName).toBe('read_file');
      expect(parsed.elapsedMs).toBeGreaterThan(0);
      expect(parsed.recommendedWaitMs).toBeGreaterThan(0);
      expect(parsed.guidance).toContain('sessions_wait');
      expect(parsed.guidance).toContain('polling again');
    });
  });

  describe('executeSessionOutput', () => {
    it('includes compact terminal worker activity evidence', async () => {
      const { getSubAgent } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        sessionId: 'sub-1',
        status: 'completed',
        startedAt: 1000,
        updatedAt: 2000,
        depth: 1,
        sandboxPolicy: 'inherit',
        output: 'completion_state: verified_success\nWorker done.',
        lastToolResultPreview: 'read_file: verified requested file content.',
        activityLog: [
          { timestamp: 1000, kind: 'tool', text: 'Using read_file: result.txt' },
          { timestamp: 1100, kind: 'result', text: 'read_file: verified requested file content.' },
        ],
      });

      const result = await executeSessionOutput({ sessionId: 'sub-1' });
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('completed');
      expect(parsed.output).toContain('completion_state: verified_success');
      expect(parsed.lastToolResultPreview).toBe('read_file: verified requested file content.');
      expect(parsed.recentActivity).toEqual([
        { timestamp: 1000, kind: 'tool', text: 'Using read_file: result.txt' },
        { timestamp: 1100, kind: 'result', text: 'read_file: verified requested file content.' },
      ]);
    });
  });

  describe('executeSessionCancel', () => {
    it('cancels a running session', async () => {
      const { getSubAgent, cancelSubAgent } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        sessionId: 'sub-1',
        status: 'running',
        startedAt: Date.now() - 5000,
      });

      const result = await executeSessionCancel({ sessionId: 'sub-1', reason: 'Wrong approach' });
      const parsed = JSON.parse(result);

      expect(cancelSubAgent).toHaveBeenCalledWith('sub-1', 'Wrong approach');
      expect(parsed.status).toBe('cancel_requested');
      expect(parsed.sessionId).toBe('sub-1');
    });
  });

  describe('executeSessionYield', () => {
    it('returns a terminal finalize signal when there are no running sub-agents', async () => {
      const result = await executeSessionYield({}, 'conv-1');
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('completed');
      expect(parsed.finalizeSupervisor).toBe(true);
      expect(parsed.pendingSessions).toEqual([]);
      expect(parsed.guidance).toContain('Finalize the supervisor response');
    });

    it('returns a checkpoint result when background sub-agents exist', async () => {
      const { getSubAgentsByParent } = require('../../src/services/agents/subAgent');
      getSubAgentsByParent.mockReturnValueOnce([
        {
          sessionId: 'sub-1',
          status: 'running',
          startedAt: 123,
        },
      ]);

      const result = await executeSessionYield(
        { message: 'Waiting for background worker' },
        'conv-1',
      );
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('checkpointed');
      expect(parsed.autoResumeSupported).toBe(false);
      expect(parsed.finalizeSupervisor).toBe(false);
      expect(parsed.message).toBe('Waiting for background worker');
      expect(parsed.pendingSessions).toHaveLength(1);
      expect(parsed.pendingSessions[0].sessionId).toBe('sub-1');
    });
  });
});
