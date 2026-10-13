// ---------------------------------------------------------------------------
// Kavi — the one conversation's live history window
// ---------------------------------------------------------------------------
// The conversation keeps its recent history live, bounded by tokens rather than by a
// message count: one message is a word, another a 30k-token tool result, so a fixed count
// held a few days of chat or a single long task. Past the limit, the oldest whole turns move
// to the transcript archive, where the person still scrolls back to them and memory still
// recalls them, until the live history is back at the target.
//
// The limit is a history size, not a model window: it is the most raw history any request
// carries. A model whose working window is smaller compacts below it at request time
// (agentTurnRequestBudget); for a 1M-token model, whose working window is 400k, this is
// the bound. The gap between limit and target makes a trim rare: the request prefix stays
// the same for many turns in between, and the prompt cache keeps hitting.
// ---------------------------------------------------------------------------

import { estimateImageInputTokens } from '../services/context/contentTokens';
import { estimateTokens, MESSAGE_FRAMING_TOKENS } from '../services/context/tokenCounter';
import type { Message } from '../types/message';
import { archiveLeavingMessages } from './chatPersistence';

export const CONVERSATION_HISTORY_TOKEN_LIMIT = 256_000;
/** Share of the limit a trim brings the history back to. */
const HISTORY_TRIM_TARGET_SHARE = 0.75;
export const CONVERSATION_HISTORY_TOKEN_TARGET = Math.floor(
  CONVERSATION_HISTORY_TOKEN_LIMIT * HISTORY_TRIM_TARGET_SHARE,
);

// Messages are immutable store values, so an estimate holds for the object's lifetime.
// A message still streaming is a new object per update and is estimated when a trim runs.
const storedMessageTokens = new WeakMap<Message, number>();

/** What a stored message adds to a request: its text, its tool calls and its images. */
export function estimateStoredMessageTokens(message: Message): number {
  const cached = storedMessageTokens.get(message);
  if (cached !== undefined) return cached;
  const text =
    message.role === 'user' ? message.enrichedContent || message.content : message.content;
  let tokens = MESSAGE_FRAMING_TOKENS + estimateTokens(text);
  for (const toolCall of message.toolCalls ?? []) {
    tokens += estimateTokens(toolCall.name) + estimateTokens(toolCall.arguments);
  }
  for (const attachment of message.attachments ?? []) {
    if (attachment.type === 'image') tokens += estimateImageInputTokens();
    else if (attachment.transcript) tokens += estimateTokens(attachment.transcript);
  }
  storedMessageTokens.set(message, tokens);
  return tokens;
}

/** A user message that starts a turn; a steering message belongs to the run it steered. */
function opensTurn(message: Message): boolean {
  return message.role === 'user' && message.steerOfRunId === undefined;
}

export type HistoryWindowSelection = Readonly<{ kept: Message[]; leaving: Message[] }>;

/**
 * The live history after the window. Unchanged while it fits the limit; otherwise it starts
 * at the earliest turn from which the history fits the target, never later than the newest
 * turn, which stays whole however large it is. Protected messages (active execution
 * anchors) before the cut stay too. Cutting only where a turn opens means no tool result
 * outlives its call.
 */
export function selectHistoryWindow(
  messages: ReadonlyArray<Message>,
  protectedMessageIds: ReadonlySet<string> = new Set(),
): HistoryWindowSelection {
  const costs = messages.map(estimateStoredMessageTokens);
  let remaining = costs.reduce((total, cost) => total + cost, 0);
  if (remaining <= CONVERSATION_HISTORY_TOKEN_LIMIT) return { kept: [...messages], leaving: [] };

  let cut = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (index > 0 && opensTurn(message)) {
      cut = index;
      if (remaining <= CONVERSATION_HISTORY_TOKEN_TARGET) break;
    }
    if (!protectedMessageIds.has(message.id)) remaining -= costs[index]!;
  }
  if (cut === 0) return { kept: [...messages], leaving: [] };

  const kept: Message[] = [];
  const leaving: Message[] = [];
  messages.forEach((message, index) => {
    if (index >= cut || protectedMessageIds.has(message.id)) kept.push(message);
    else leaving.push(message);
  });
  return { kept, leaving };
}

/** Applies the window to a conversation's next messages; what leaves goes to the archive. */
export function applyHistoryWindow(
  conversationId: string,
  messages: Message[],
  protectedMessageIds: ReadonlySet<string> = new Set(),
): Message[] {
  const { kept, leaving } = selectHistoryWindow(messages, protectedMessageIds);
  if (leaving.length === 0) return messages;
  archiveLeavingMessages(conversationId, leaving);
  return kept;
}
