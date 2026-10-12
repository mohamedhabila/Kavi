// ---------------------------------------------------------------------------
// Kavi — LongMemEval as a Kavi conversation
// ---------------------------------------------------------------------------
// Kavi is one conversation, so a LongMemEval history is that conversation's earlier
// messages and the question is the user's next message, asked on the question's date.
// Two arms put the history where the app would hold it:
//   memory  — the history has left the request (an older stretch of the thread): its
//             rounds are indexed by the app's own capture path and reach the model only
//             through the memory section and memory_search.
//   context — the whole history is still in the thread the request carries: the
//             long-context reference the memory arm is measured against.
// ---------------------------------------------------------------------------

import { indexClosedTurn } from '../../services/memory/core/memoryTurnsStore';
import type { Message } from '../../types/message';
import type { E2EScenario } from '../e2eAgent/types';
import type { LongMemEvalInstance } from './longMemEvalDataset';

export const LONGMEMEVAL_ARMS = ['memory', 'context'] as const;
export type LongMemEvalArm = (typeof LONGMEMEVAL_ARMS)[number];

const HISTORY_MESSAGE_ID_PREFIX = 'lme';

function historyMessageId(sessionIndex: number, turnIndex: number): string {
  return `${HISTORY_MESSAGE_ID_PREFIX}-${sessionIndex}-${turnIndex}`;
}

/** The session a history message id came from, or null for any other message. */
export function sessionIndexOfHistoryMessage(messageId: string): number | null {
  const match = /^lme-(\d+)-\d+$/.exec(messageId);
  return match ? Number(match[1]) : null;
}

/**
 * The history as the conversation's earlier messages, each reply closed the way a finished
 * reply is. Messages of a session share its date, a millisecond apart to keep their order.
 */
export function buildLongMemEvalHistoryMessages(instance: LongMemEvalInstance): Message[] {
  return instance.sessions.flatMap((session, sessionIndex) =>
    session.turns.map((turn, turnIndex): Message => {
      const base = {
        id: historyMessageId(sessionIndex, turnIndex),
        content: turn.content,
        timestamp: session.at + turnIndex,
      };
      return turn.role === 'user'
        ? { ...base, role: 'user' }
        : {
            ...base,
            role: 'assistant',
            assistantMetadata: {
              kind: 'final',
              completionStatus: 'complete',
              finishReason: 'stop',
            },
          };
    }),
  );
}

/** Indexes every round of the history under `conversationId`; returns how many were kept. */
export function indexLongMemEvalHistory(
  conversationId: string,
  messages: ReadonlyArray<Message>,
): number {
  let indexed = 0;
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    if (indexClosedTurn({ conversationId, messages, replyMessageId: message.id })) indexed += 1;
  }
  return indexed;
}

export function buildLongMemEvalScenario(
  instance: LongMemEvalInstance,
  arm: LongMemEvalArm,
): E2EScenario {
  return {
    id: `longmemeval-${instance.questionId}`,
    conversationId: 'longmemeval',
    contentClass: 'synthetic_public',
    execution: { initialMode: 'chitchat', route: 'production_auto' },
    prompt: instance.question,
    rubrics: [],
    ...(arm === 'context' ? { initialMessages: buildLongMemEvalHistoryMessages(instance) } : {}),
  };
}
