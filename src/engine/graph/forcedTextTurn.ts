import type { AgentRunControlGraphForcedTextReason } from '../../types/agentRun';

export type AgentControlGraphForcedTextReason = AgentRunControlGraphForcedTextReason;

export function buildAgentControlGraphForcedTextOnlyTurnPrompt(
  reason?: AgentControlGraphForcedTextReason,
): string {
  switch (reason) {
    case 'async_terminal_completion':
      return '[SYSTEM FINAL DELIVERY]\nTool use is disabled for this turn.\nAsync work is terminal; answer from the verified result now.\nPreserve exact requested format.';
    case 'background_session_started':
      return '[SYSTEM BACKGROUND HANDOFF]\nTool use is disabled for this turn.\nThe requested detached session has started. Mobile operating systems may suspend background execution. Return control to the user now with a concise status; do not claim completion or guaranteed continuous execution.';
    case 'workflow_route_completed':
      return '[SYSTEM FINAL DELIVERY]\nTool use is disabled for this turn.\nThe workflow is complete; answer from verified evidence now.\nPreserve exact requested format.';
    case 'yield_finalization':
      return '[SYSTEM FINAL DELIVERY]\nTool use is disabled for this turn.\nThe workflow is complete; deliver the final answer now.';
    case 'persistent_context_settled':
      return '[SYSTEM FINAL DELIVERY]\nTool use is disabled for this turn.\nThe active context is updated and no blocking goal remains; answer from the current graph and memory state now.';
    case 'incomplete_delivery_continuation':
      return '[SYSTEM FINAL ANSWER CONTINUE]\nTool use is disabled for this turn.\nContinue the interrupted final answer from where it stopped.\nPreserve the existing answer and finish cleanly.';
    case 'empty_delivery_recovery':
      return '[SYSTEM EMPTY RESPONSE RECOVERY]\nTool use is disabled for this turn.\nReturn one concise, visible user-facing answer now.\nState the verified outcome or the concrete blocker; do not return an empty response.';
    case 'request_clarification':
      return '[SYSTEM CLARIFICATION REQUIRED]\nTool use is disabled for this turn.\nAsk one concise clarification question for the missing required information.';
    case 'request_consent':
      return '[SYSTEM CONSENT REQUIRED]\nTool use is disabled for this turn.\nState the specific proposed action, why approval is required, and ask for focused consent without claiming the action occurred.';
    case 'request_decline':
      return '[SYSTEM REQUEST DECLINED]\nTool use is disabled for this turn.\nState the policy or capability boundary plainly, do not claim execution, and offer a safe alternative only when one is genuinely available.';
    case 'request_wait':
      return '[SYSTEM WAITING FOR VERIFIED RESULT]\nTool use is disabled for this turn.\nState what is still pending and that no verified completion is available yet; do not repeat or invent the side effect.';
    case 'execution_loop_recovery':
      return '[SYSTEM EXECUTION BLOCKED]\nTool use is disabled for this turn.\nState the unverified requested side effect, the blocker, and the smallest missing input if autonomous progress is no longer possible.';
    case 'foreground_budget_checkpoint':
      return '[SYSTEM FOREGROUND CHECKPOINT]\nTool use is disabled for this turn.\nThis foreground turn has reached its bounded work window before finishing. In the user\'s own language, concisely report what has been done so far, what remains, and ask whether to continue. Do not claim the task is complete if work remains, and do not invent a tool result. The next message can resume the work.';
    case 'loop_recovery':
    default:
      return '[SYSTEM DIRECT RESPONSE REQUIRED]\nTool use is disabled for this turn.\nAnswer from gathered evidence, or state the blocker clearly if the evidence is still insufficient.';
  }
}
