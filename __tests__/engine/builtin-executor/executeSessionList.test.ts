// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeSessionList
// ---------------------------------------------------------------------------

import { executeSessionList } from '../../helpers/builtinExecutorHarness';

describe('Builtin Tool Executor', () => {
  describe('executeSessionList', () => {
    it('lists active sessions', async () => {
      const result = await executeSessionList();
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty('sessions');
    });

    it('lists non-empty sessions', async () => {
      const { listActiveSubAgents } = require('../../../src/services/agents/subAgent');
      listActiveSubAgents.mockReturnValueOnce([
        { sessionId: 's1', status: 'running', prompt: 'Task 1', startedAt: Date.now() },
      ]);
      const result = await executeSessionList();
      const parsed = JSON.parse(result);
      expect(parsed.sessions.length).toBe(1);
    });
  });
});
