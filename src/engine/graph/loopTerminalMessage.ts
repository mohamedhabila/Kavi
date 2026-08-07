import type { AgentGoal } from '../../types/agentRun';
import { isBlockingGoal } from '../goals/types';

/**
 * Loop-detection details are engineering diagnostics: "CRITICAL: 3 consecutive
 * update_goals calls without goal state change". They are written for the run
 * journal, and they were previously handed straight through as the assistant's final
 * response for the turn — so a recovery mechanism working exactly as designed read to
 * the user as an internal error, and said nothing about their actual request.
 *
 * The diagnostic keeps going to the observability channel, where it belongs. The user
 * gets a plain statement of what stopped and what was left unfinished, with no claim
 * of success the run did not earn.
 */
export function buildLoopDetectedUserMessage(goals: ReadonlyArray<AgentGoal>): string {
  const opening =
    'I stopped because I was repeating the same step without making progress, and continuing that way would not have moved the task forward.';
  const closing = 'Tell me how you would like to proceed and I will pick it up from there.';

  const unfinishedTitles = goals
    .filter(
      (goal) => isBlockingGoal(goal) && (goal.status === 'active' || goal.status === 'blocked'),
    )
    .map((goal) => goal.title.trim())
    .filter((title) => title.length > 0);

  if (unfinishedTitles.length === 0) {
    return `${opening} ${closing}`;
  }

  return `${opening} Still unfinished: ${unfinishedTitles.join('; ')}. ${closing}`;
}
