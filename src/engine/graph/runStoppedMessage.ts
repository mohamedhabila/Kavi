// ---------------------------------------------------------------------------
// Kavi — Run-stopped messages
// ---------------------------------------------------------------------------
// When the engine ends a run itself — a step limit, a loop, a refused approval, a
// model that returned nothing usable — it writes the assistant's final message for
// that turn. That message is what the user reads, so it is resolved through i18n in
// the user's language at delivery, in plain words: the engineering detail behind the
// stop stays on the observability channel, where it belongs.
// ---------------------------------------------------------------------------

import { i18n } from '../../i18n/manager';
import type { AgentGoal } from '../../types/agentRun';
import { isBlockingGoal } from '../goals/types';

export type RunStoppedReason =
  | 'step_limit'
  | 'repeating_step'
  | 'memory_changed'
  | 'no_usable_reply'
  | 'no_way_to_continue'
  | 'approval_declined'
  | 'takeover_required'
  | 'action_not_recorded';

const MESSAGE_KEYS: Record<RunStoppedReason, string> = {
  step_limit: 'chat.runStopped.stepLimit',
  repeating_step: 'chat.runStopped.repeatingStep',
  memory_changed: 'chat.runStopped.memoryChanged',
  no_usable_reply: 'chat.runStopped.noUsableReply',
  no_way_to_continue: 'chat.runStopped.noWayToContinue',
  approval_declined: 'chat.runStopped.approvalDeclined',
  takeover_required: 'chat.runStopped.takeoverRequired',
  action_not_recorded: 'chat.runStopped.actionNotRecorded',
};

/** Titles of the blocking goals the run left open, in the order they were declared. */
function unfinishedGoalTitles(goals: ReadonlyArray<AgentGoal>): string[] {
  return goals
    .filter(
      (goal) => isBlockingGoal(goal) && (goal.status === 'active' || goal.status === 'blocked'),
    )
    .map((goal) => goal.title.trim())
    .filter((title) => title.length > 0);
}

/**
 * The user-facing final message for a run the engine stopped. When `goals` is given,
 * the blocking goals still open are listed one per line, so the user can see what was
 * left undone without the run claiming progress it did not make.
 */
export function buildRunStoppedMessage(
  reason: RunStoppedReason,
  goals: ReadonlyArray<AgentGoal> = [],
): string {
  const message = i18n.t(MESSAGE_KEYS[reason]);
  const titles = unfinishedGoalTitles(goals);
  if (titles.length === 0) {
    return message;
  }
  return [
    message,
    '',
    i18n.t('chat.runStopped.unfinished'),
    ...titles.map((title) => `• ${title}`),
  ].join('\n');
}
