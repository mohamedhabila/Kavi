import type { Message } from '../types/message';

type TurnMessage = Pick<Message, 'role' | 'steerOfRunId'>;

/**
 * A user message sent while an agent run was already working, which the run read at its
 * next step. It continues that run's turn rather than opening a new one, so every place
 * that finds where a turn begins must look past it.
 */
export function isSteeringUserMessage(message: TurnMessage | undefined): boolean {
  return (
    message?.role === 'user' &&
    typeof message.steerOfRunId === 'string' &&
    message.steerOfRunId.length > 0
  );
}

/** A user message that opens a turn: any user message except one steering a running turn. */
export function isTurnOpeningUserMessage(message: TurnMessage | undefined): boolean {
  return message?.role === 'user' && !isSteeringUserMessage(message);
}

/**
 * Index of the user message that opened the turn the message at `index` belongs to: the
 * nearest earlier turn-opening user message, or -1 when there is none.
 */
export function findTurnOpeningUserIndex(
  messages: ReadonlyArray<TurnMessage>,
  index: number,
): number {
  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    if (isTurnOpeningUserMessage(messages[candidate])) return candidate;
  }
  return -1;
}
