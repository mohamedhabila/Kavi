// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeSessionSend — error safety
// ---------------------------------------------------------------------------

import { executeSessionSend, MOCK_PROVIDER } from '../../helpers/builtinExecutorHarness';

describe('Builtin Tool Executor', () => {
  describe('executeSessionSend — error safety', () => {
    it('handles non-Error thrown objects in re-spawn failure', async () => {
      const { getSubAgent, launchSubAgent } = require('../../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Done',
        parentConversationId: 'conv-1',
      });
      launchSubAgent.mockRejectedValueOnce('string error');
      const result = await executeSessionSend(
        { sessionId: 'old-789', message: 'more' },
        MOCK_PROVIDER,
      );
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toBe('string error');
    });
  });
});
