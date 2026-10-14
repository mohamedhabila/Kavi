// ---------------------------------------------------------------------------
// Kavi — LongMemEval as a Kavi conversation
// ---------------------------------------------------------------------------
// Kavi is one conversation, so a LongMemEval history is that conversation's earlier
// messages and the question is the user's next message, asked on the question's date.
// Two arms put the history where the app would hold it:
//   memory  — the history has left the request (an older stretch of the thread): its
//             rounds are indexed by the app's own capture path and reach the model only
//             through the memory section and memory_search. Background extraction counts
//             them as already read, as it would have read each one soon after it closed;
//             extracting a whole history at question time would only add its cost (about
//             125 extraction calls for one LongMemEval-S history) after the answer.
//   context — the whole history is still in the thread the request carries: the
//             long-context reference the memory arm is measured against.
//   window  — the most recent stretch of the history, up to a token budget, is still in the
//             thread and everything older has left it: every round is indexed, as capture
//             indexes each round when it closes, and the older ones reach the model only
//             through memory. It is how much raw history a request should keep.
//   extract — the memory arm with background extraction run over the whole history before
//             the question, through the app's own worker, as it would have run after each
//             round: what extracted memories add over past rounds alone, and what the store
//             fills with.
// ---------------------------------------------------------------------------

import { estimateTokens } from '../../services/context/tokenCounter';
import { skipCaptureThrough } from '../../services/memory/core/memoryCaptureCursor';
import {
  scheduleMemoryExtraction,
  waitForMemoryExtractionIdle,
} from '../../services/memory/core/memoryExtractionWorker';
import { indexClosedTurn } from '../../services/memory/core/memoryTurnsStore';
import type { Message } from '../../types/message';
import type { E2EScenario } from '../e2eAgent/types';
import type { LongMemEvalInstance } from './longMemEvalDataset';

export const LONGMEMEVAL_ARMS = ['memory', 'context', 'window', 'extract'] as const;
export type LongMemEvalArm = (typeof LONGMEMEVAL_ARMS)[number];

const HISTORY_MESSAGE_ID_PREFIX = 'lme';

export function historyMessageId(sessionIndex: number, turnIndex: number): string {
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

function indexRounds(conversationId: string, messages: ReadonlyArray<Message>): number {
  let indexed = 0;
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    if (indexClosedTurn({ conversationId, messages, replyMessageId: message.id })) indexed += 1;
  }
  return indexed;
}

/**
 * Indexes every round of the history under `conversationId` and moves the capture cursor past
 * it, so extraction starts at the question; returns how many rounds were kept.
 */
export function indexLongMemEvalHistory(
  conversationId: string,
  messages: ReadonlyArray<Message>,
): number {
  const indexed = indexRounds(conversationId, messages);
  const last = messages[messages.length - 1];
  if (last) skipCaptureThrough(conversationId, last.timestamp, Date.now());
  return indexed;
}

/**
 * Indexes every round of the history and lets the extraction worker read all of them, as it
 * would have after each round closed. Resolves once extraction is idle, or with
 * `settled: false` when `timeoutMs` passes first: the question is still asked.
 */
export async function extractLongMemEvalHistory(
  conversationId: string,
  messages: ReadonlyArray<Message>,
  timeoutMs: number,
): Promise<{ indexed: number; settled: boolean }> {
  const indexed = indexRounds(conversationId, messages);
  scheduleMemoryExtraction(conversationId);
  return { indexed, settled: await waitForMemoryExtractionIdle(timeoutMs) };
}

/**
 * The most recent whole rounds of `messages` that fit in `maxTokens`, in order. A round is a
 * user message and the replies after it; the window never starts on a reply.
 */
export function selectLongMemEvalWindow(
  messages: ReadonlyArray<Message>,
  maxTokens: number,
): Message[] {
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return [];
  let start = messages.length;
  let used = 0;
  let roundTokens = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    roundTokens += estimateTokens(messages[index]!.content);
    if (messages[index]!.role !== 'user') continue;
    if (used + roundTokens > maxTokens) break;
    used += roundTokens;
    roundTokens = 0;
    start = index;
  }
  return messages.slice(start);
}

export function buildLongMemEvalScenario(
  instance: LongMemEvalInstance,
  arm: LongMemEvalArm,
  windowTokens = 0,
): E2EScenario {
  const history =
    arm === 'memory' || arm === 'extract' ? [] : buildLongMemEvalHistoryMessages(instance);
  const initialMessages =
    arm === 'context'
      ? history
      : arm === 'window'
        ? selectLongMemEvalWindow(history, windowTokens)
        : [];
  return {
    id: `longmemeval-${instance.questionId}`,
    conversationId: 'longmemeval',
    contentClass: 'synthetic_public',
    prompt: instance.question,
    rubrics: [],
    ...(initialMessages.length > 0 ? { initialMessages } : {}),
  };
}
