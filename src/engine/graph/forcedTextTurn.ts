import type { AgentRunControlGraphForcedTextReason } from '../../types/agentRun';

export type AgentControlGraphForcedTextReason = AgentRunControlGraphForcedTextReason;

export function buildAgentControlGraphForcedTextOnlyTurnPrompt(
  reason?: AgentControlGraphForcedTextReason,
): string {
  switch (reason) {
    case 'background_session_started':
      return '[SYSTEM BACKGROUND HANDOFF]\nTool use is disabled for this turn.\nThe requested detached session has started. Mobile operating systems may suspend background execution. Return control to the user now with a concise status; do not claim completion or guaranteed continuous execution.';
    case 'yield_finalization':
      return '[SYSTEM FINAL DELIVERY]\nTool use is disabled for this turn.\nThe workflow is complete; deliver the final answer now.';
    case 'incomplete_delivery_continuation':
      return '[SYSTEM FINAL ANSWER CONTINUE]\nTool use is disabled for this turn.\nContinue the interrupted final answer from where it stopped.\nPreserve the existing answer and finish cleanly.';
    case 'empty_delivery_recovery':
      return '[SYSTEM EMPTY RESPONSE RECOVERY]\nTool use is disabled for this turn.\nReturn one concise, visible user-facing answer now.\nState the verified outcome or the concrete blocker; do not return an empty response.';
    case 'execution_loop_recovery':
      return '[SYSTEM EXECUTION BLOCKED]\nTool use is disabled for this turn.\nState the unverified requested side effect, the blocker, and the smallest missing input if autonomous progress is no longer possible.';
    case 'loop_recovery':
    default:
      return '[SYSTEM DIRECT RESPONSE REQUIRED]\nTool use is disabled for this turn.\nAnswer from gathered evidence, or state the blocker clearly if the evidence is still insufficient.';
  }
}
