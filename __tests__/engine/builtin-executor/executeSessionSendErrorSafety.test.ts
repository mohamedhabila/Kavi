// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeSessionSend — error safety
// ---------------------------------------------------------------------------

import { executeSessionSend, MOCK_PROVIDER } from '../../helpers/builtinExecutorHarness';
import { parseFailedToolOutcome } from '../../helpers/toolRuntimeOutcome';

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
      const parsed = parseFailedToolOutcome(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toBe('string error');
    });

    it('returns a closed error for a malformed persisted workspace identity', async () => {
      const {
        getSessionContext,
        getSubAgent,
        launchSubAgent,
      } = require('../../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        sessionId: 'old-789',
        status: 'completed',
        parentConversationId: 'conv-1',
      });
      getSessionContext.mockReturnValueOnce({
        config: {
          parentConversationId: 'conv-1',
          workspaceConversationId: ' conv-private',
        },
      });

      const parsed = parseFailedToolOutcome(
        await executeSessionSend({ sessionId: 'old-789', message: 'more' }, MOCK_PROVIDER),
      );

      expect(parsed).toEqual({
        status: 'error',
        error: 'conversation_workspace_configured_id_invalid',
      });
      expect(launchSubAgent).not.toHaveBeenCalled();
    });
  });
});
