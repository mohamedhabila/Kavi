import type { AgentRunControlGraphForcedTextReason } from '../../types/agentRun';

export type AgentControlGraphForcedTextReason = AgentRunControlGraphForcedTextReason;

export function buildAgentControlGraphForcedTextOnlyTurnPrompt(
  reason?: AgentControlGraphForcedTextReason,
): string {
  switch (reason) {
    case 'async_terminal_completion':
      return '[SYSTEM FINAL DELIVERY]\nTool use is disabled for this turn.\nAsync work is terminal; answer from the verified result now.\nPreserve exact requested format.';
    case 'workflow_route_completed':
      return '[SYSTEM FINAL DELIVERY]\nTool use is disabled for this turn.\nThe workflow is complete; answer from verified evidence now.\nPreserve exact requested format.';
    case 'yield_finalization':
      return '[SYSTEM FINAL DELIVERY]\nTool use is disabled for this turn.\nThe workflow is complete; deliver the final answer now.';
    case 'persistent_context_settled':
      return '[SYSTEM FINAL DELIVERY]\nTool use is disabled for this turn.\nThe active context is updated and no blocking goal remains; answer from the current graph and memory state now.';
    case 'incomplete_delivery_continuation':
      return '[SYSTEM FINAL ANSWER CONTINUE]\nTool use is disabled for this turn.\nContinue the interrupted final answer from where it stopped.\nPreserve the existing answer and finish cleanly.';
    case 'request_governance':
      return '[SYSTEM CLARIFICATION REQUIRED]\nTool use is disabled for this turn.\nAsk one concise clarification question for the missing required information.';
    case 'execution_loop_recovery':
      return '[SYSTEM EXECUTION BLOCKED]\nTool use is disabled for this turn.\nState the unverified requested side effect, the blocker, and the smallest missing input if autonomous progress is no longer possible.';
    case 'loop_recovery':
    default:
      return '[SYSTEM DIRECT RESPONSE REQUIRED]\nTool use is disabled for this turn.\nAnswer from gathered evidence, or state the blocker clearly if the evidence is still insufficient.';
  }
}
