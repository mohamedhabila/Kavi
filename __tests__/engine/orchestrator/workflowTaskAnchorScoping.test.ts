// ---------------------------------------------------------------------------
// Tests - Orchestrator: workflow task anchor scoping
// ---------------------------------------------------------------------------
// The anchor protects task fidelity across long, delegation-capable execution.
// It must never appear for chitchat, and among agentic runs it should appear
// only when the run can delegate (sessions_spawn on its surface) or is itself a
// delegated worker (recognized here by the absence of workflowScopeUserMessageId,
// which every interactive foreground chat turn carries but a worker run never
// sets — see subAgentOrchestratorRun.ts).
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

const ANCHOR_HEADING = '## Workflow Task Anchor';

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
  describe('workflow task anchor scoping', () => {
    it('never attaches the anchor to a chitchat turn', async () => {
      mockStreamMessage.mockImplementationOnce(okStream);

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-chitchat',
        systemPrompt: 'You are helpful',
        workflowScopeUserMessageId: 'msg1',
        messages: [
          { id: 'msg1', role: 'user', content: 'What time is it in Tokyo?', timestamp: Date.now() },
        ],
      };

      await runOrchestrator(options, callbacks);

      const apiMessages = mockStreamMessage.mock.calls[0][0];
      expect(apiMessages[0].content).not.toContain(ANCHOR_HEADING);
    });

    it('omits the anchor for a plain agentic turn that cannot delegate', async () => {
      useSuperAgentPersona();
      mockStreamMessage.mockImplementationOnce(okStream);

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-agentic-no-delegation',
        personaId: 'super-agent',
        systemPrompt: 'You are helpful',
        // A real interactive chat turn always carries this.
        workflowScopeUserMessageId: 'msg1',
        // sessions_spawn is deliberately excluded from this turn's surface.
        toolFilter: allowTools(['web_search']),
        messages: [
          { id: 'msg1', role: 'user', content: 'Summarize this for me.', timestamp: Date.now() },
        ],
      };

      await runOrchestrator(options, callbacks);

      const apiMessages = mockStreamMessage.mock.calls[0][0];
      expect(apiMessages[0].content).not.toContain(ANCHOR_HEADING);
    });

    // The anchor is deliberately suppressed on an iteration-1 turn whose sole
    // working message already matches it verbatim (pure redundancy — see
    // `transcriptCarriesSoleFirstTurnAnchor` in buildPreparedPromptTurn.ts), so
    // these two cases drive a tool-call round trip and assert on the *second*
    // model turn, where the anchor's protection against transcript drift matters.
    function toolCallThenFinalTextStreams() {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator(
          [
            { type: 'token', content: '' },
            {
              type: 'tool_call',
              toolCall: { id: 'tc1', name: 'web_search', arguments: '{"query":"vendors"}' },
            },
            { type: 'done', content: '' },
          ],
          'tool',
        ),
      );
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator(
          [
            { type: 'token', content: 'Done.' },
            { type: 'done', content: 'Done.' },
          ],
          'text',
        ),
      );
    }

    it('attaches the anchor on later turns when sessions_spawn is on the agentic turn surface', async () => {
      useSuperAgentPersona();
      toolCallThenFinalTextStreams();

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-agentic-can-delegate',
        personaId: 'super-agent',
        systemPrompt: 'You are helpful',
        workflowScopeUserMessageId: 'msg1',
        toolFilter: allowTools(['sessions_spawn', 'sessions_wait', 'web_search']),
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Research three vendors and summarize them.',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
      const secondTurnMessages = mockStreamMessage.mock.calls[1][0];
      expect(secondTurnMessages[0].content).toContain(ANCHOR_HEADING);
    });

    it('attaches the anchor on later turns for a delegated worker run even without sessions_spawn on its surface', async () => {
      useSuperAgentPersona();
      toolCallThenFinalTextStreams();

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-worker',
        personaId: 'super-agent',
        systemPrompt: 'You are helpful',
        // Worker runs never set workflowScopeUserMessageId (see subAgentOrchestratorRun.ts).
        // The worker's own strict tool allowlist deliberately omits sessions_spawn.
        toolFilter: allowTools(['web_search']),
        messages: [
          {
            id: 'worker-task-msg',
            role: 'user',
            content: 'You are the worker assigned to one graph-owned task.',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
      const secondTurnMessages = mockStreamMessage.mock.calls[1][0];
      expect(secondTurnMessages[0].content).toContain(ANCHOR_HEADING);
    });
  });
});
