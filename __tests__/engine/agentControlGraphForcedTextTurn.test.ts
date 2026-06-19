import {
  buildAgentControlGraphForcedTextOnlyTurnPrompt,
  type AgentControlGraphForcedTextReason,
} from '../../src/engine/graph/forcedTextTurn';

describe('agent control graph forced text turns', () => {
  it.each<
    [
      reason: AgentControlGraphForcedTextReason,
      expectedHeading: string,
      expectedContract: string,
    ]
  >([
    [
      'async_terminal_completion',
      '[SYSTEM FINAL DELIVERY]',
      'Async work is terminal; answer from the verified result now.',
    ],
    [
      'workflow_route_completed',
      '[SYSTEM FINAL DELIVERY]',
      'The workflow is complete; answer from verified evidence now.',
    ],
    [
      'yield_finalization',
      '[SYSTEM FINAL DELIVERY]',
      'The workflow is complete; deliver the final answer now.',
    ],
    [
      'incomplete_delivery_continuation',
      '[SYSTEM FINAL ANSWER CONTINUE]',
      'Continue the interrupted final answer from where it stopped.',
    ],
    [
      'request_governance',
      '[SYSTEM CLARIFICATION REQUIRED]',
      'Ask one concise clarification question for the missing required information.',
    ],
    [
      'persistent_context_settled',
      '[SYSTEM FINAL DELIVERY]',
      'The active context is updated and no blocking goal remains',
    ],
    [
      'execution_loop_recovery',
      '[SYSTEM EXECUTION BLOCKED]',
      'State the unverified requested side effect, the blocker, and the smallest missing input',
    ],
    [
      'loop_recovery',
      '[SYSTEM DIRECT RESPONSE REQUIRED]',
      'Answer from gathered evidence, or state the blocker clearly',
    ],
  ])(
    'builds the forced text prompt for %s',
    (reason, expectedHeading, expectedContract) => {
      const prompt = buildAgentControlGraphForcedTextOnlyTurnPrompt(reason);

      expect(prompt).toContain(expectedHeading);
      expect(prompt).toContain(expectedContract);
      expect(prompt).toContain('Tool use is disabled for this turn');
    },
  );

  it('uses loop recovery as the fail-closed fallback', () => {
    expect(buildAgentControlGraphForcedTextOnlyTurnPrompt()).toBe(
      buildAgentControlGraphForcedTextOnlyTurnPrompt('loop_recovery'),
    );
    expect(
      buildAgentControlGraphForcedTextOnlyTurnPrompt(
        'unsupported_reason' as AgentControlGraphForcedTextReason,
      ),
    ).toBe(buildAgentControlGraphForcedTextOnlyTurnPrompt('loop_recovery'));
  });

  it('prioritizes exact final-output constraints in completed workflow prompts', () => {
    expect(buildAgentControlGraphForcedTextOnlyTurnPrompt('workflow_route_completed')).toContain(
      'Preserve exact requested format.',
    );
    expect(buildAgentControlGraphForcedTextOnlyTurnPrompt('async_terminal_completion')).toContain(
      'Preserve exact requested format.',
    );
  });
});
