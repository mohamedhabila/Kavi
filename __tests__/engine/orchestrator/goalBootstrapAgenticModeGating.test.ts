// ---------------------------------------------------------------------------
// Tests - Orchestrator: goal bootstrap gated to agentic mode
// ---------------------------------------------------------------------------
// update_goals is a `goal`-category tool, and conversationModeToolAuthority.ts
// excludes every `goal`-category tool from chitchat mode unconditionally — so
// the goal-bootstrap prompt section (which only renders when update_goals is on
// the turn's selected tool surface) can never reach a chitchat turn, even when a
// caller tries to force it onto the surface with an explicit tool filter.
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  mockStreamMessage,
  makeProvider,
  makeCallbacks,
  createStreamGenerator,
  useSuperAgentPersona,
  allowTools,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';

const BOOTSTRAP_HEADING = '## Goal Tracking for Multi-Step Work';

function okStream() {
  return createStreamGenerator(
    [
      { type: 'token', content: 'OK' },
      { type: 'done', content: 'OK' },
    ],
    'text',
  );
}

describe('Orchestrator', () => {
  describe('goal bootstrap agentic-mode gating', () => {
    it('never offers the goal bootstrap in chitchat mode, even when update_goals is force-allowed', async () => {
      mockStreamMessage.mockImplementationOnce(okStream);

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-chitchat-goal-bootstrap',
        systemPrompt: 'You are helpful',
        // No personaId => not the SuperAgent persona => chitchat mode. Attempting to
        // force update_goals onto the surface cannot succeed: filterToolsForConversationMode
        // already dropped it before this allowlist is ever applied.
        toolFilter: allowTools(['update_goals']),
        messages: [
          { id: 'msg1', role: 'user', content: 'Plan a multi-step trip.', timestamp: Date.now() },
        ],
      };

      await runOrchestrator(options, callbacks);

      const apiMessages = mockStreamMessage.mock.calls[0][0];
      expect(apiMessages[0].content).not.toContain(BOOTSTRAP_HEADING);
      expect(apiMessages[0].content).not.toContain('update_goals');
    });

    it('offers the goal bootstrap in agentic mode when update_goals is on the surface', async () => {
      useSuperAgentPersona();
      mockStreamMessage.mockImplementationOnce(okStream);

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-agentic-goal-bootstrap',
        personaId: 'super-agent',
        systemPrompt: 'You are helpful',
        toolFilter: allowTools(['update_goals']),
        messages: [
          { id: 'msg1', role: 'user', content: 'Plan a multi-step trip.', timestamp: Date.now() },
        ],
      };

      await runOrchestrator(options, callbacks);

      const apiMessages = mockStreamMessage.mock.calls[0][0];
      expect(apiMessages[0].content).toContain(BOOTSTRAP_HEADING);
    });
  });
});
