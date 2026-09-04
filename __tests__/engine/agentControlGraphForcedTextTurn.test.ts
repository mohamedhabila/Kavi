import {
  buildAgentControlGraphForcedTextOnlyTurnPrompt,
  type AgentControlGraphForcedTextReason,
} from '../../src/engine/graph/forcedTextTurn';

describe('agent control graph forced text turns', () => {
  it.each<
    [reason: AgentControlGraphForcedTextReason, expectedHeading: string, expectedContract: string]
  >([
    [
      'async_terminal_completion',
      '[SYSTEM FINAL DELIVERY]',
      'Async work is terminal; answer from the verified result now.',
    ],
    [
      'background_session_started',
      '[SYSTEM BACKGROUND HANDOFF]',
      'Return control to the user now with a concise status',
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
      'empty_delivery_recovery',
      '[SYSTEM EMPTY RESPONSE RECOVERY]',
      'State the verified outcome or the concrete blocker',
    ],
    [
      'request_clarification',
      '[SYSTEM CLARIFICATION REQUIRED]',
      'Ask one concise clarification question for the missing required information.',
    ],
    [
      'request_consent',
      '[SYSTEM CONSENT REQUIRED]',
      'ask for focused consent without claiming the action occurred.',
    ],
    ['request_decline', '[SYSTEM REQUEST DECLINED]', 'do not claim execution'],
    [
      'request_wait',
      '[SYSTEM WAITING FOR VERIFIED RESULT]',
      'no verified completion is available yet',
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
      'foreground_budget_checkpoint',
      '[SYSTEM FOREGROUND CHECKPOINT]',
      'concisely report what has been done so far, what remains, and ask whether to continue',
    ],
    [
      'loop_recovery',
      '[SYSTEM DIRECT RESPONSE REQUIRED]',
      'Answer from gathered evidence, or state the blocker clearly',
    ],
  ])('builds the forced text prompt for %s', (reason, expectedHeading, expectedContract) => {
    const prompt = buildAgentControlGraphForcedTextOnlyTurnPrompt(reason);

    expect(prompt).toContain(expectedHeading);
    expect(prompt).toContain(expectedContract);
    expect(prompt).toContain('Tool use is disabled for this turn');
  });

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

  it('does not promise continuous mobile execution after a background handoff', () => {
    const prompt = buildAgentControlGraphForcedTextOnlyTurnPrompt('background_session_started');

    expect(prompt).toContain('Mobile operating systems may suspend background execution');
    expect(prompt).toContain('do not claim completion or guaranteed continuous execution');
  });

  it('tells the model to answer in the user\'s own language and stay resumable at the foreground checkpoint', () => {
    const prompt = buildAgentControlGraphForcedTextOnlyTurnPrompt('foreground_budget_checkpoint');

    expect(prompt).toContain("In the user's own language");
    expect(prompt).toContain('Do not claim the task is complete if work remains');
    expect(prompt).toContain('do not invent a tool result');
    expect(prompt).toContain('The next message can resume the work.');
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
