// ---------------------------------------------------------------------------
// Kavi — Capturing chat turns into memory
// ---------------------------------------------------------------------------
// When a turn closes, its round is indexed as a past turn and its thread is queued for
// background extraction; both are idempotent, so publishing a turn twice is harmless and
// nothing needs to remember that it happened. A launch catches up on turns closed while the
// app was killed. Side threads keep no memory, and nothing is captured while memory is
// off; turning it back on moves every thread's cursor past what was said meanwhile.
// ---------------------------------------------------------------------------

import { useSettingsStore } from '../../../store/useSettingsStore';
import type { Conversation } from '../../../types/conversation';
import type { Message } from '../../../types/message';
import { hasTerminalAssistantCompletionMetadata } from '../../../utils/assistantMessageMetadata';
import { createLogger } from '../../../utils/logger';
import { getMemoryDb } from '../database';
import {
  deleteCaptureCursor,
  readCaptureCursor,
  recordTurnsIndexedThrough,
  skipCaptureThrough,
} from './memoryCaptureCursor';
import { cancelMemoryExtraction, scheduleMemoryExtraction } from './memoryExtractionWorker';
import { deleteAllMemoryItems, deleteMemoryItemsFromConversation } from './memoryItemsStore';
import {
  deleteAllMemoryPromptBuilds,
  deleteMemoryPromptBuildsFromConversation,
} from './memoryPromptLog';
import { ensureMemoryCoreSchema } from './memorySchema';
import {
  deleteAllMemoryTurns,
  deleteMemoryTurnsFromConversation,
  indexClosedTurn,
} from './memoryTurnsStore';

const logger = createLogger('memory.capture');

/** Captures the turn the reply `replyMessageId` closed in chat thread `conversationId`. */
export type RecordConversationTurnMemory = (conversationId: string, replyMessageId: string) => void;

type CaptureThread = Pick<Conversation, 'id' | 'isSideThread' | 'messages'>;

function isMemoryOn(): boolean {
  return useSettingsStore.getState().disableLongTermMemory !== true;
}

function isClosedReply(message: Message): boolean {
  return (
    message.role === 'assistant' &&
    !message.subAgentEvent &&
    hasTerminalAssistantCompletionMetadata(message)
  );
}

function captureTurn(thread: CaptureThread, reply: Message): void {
  indexClosedTurn({
    conversationId: thread.id,
    messages: thread.messages,
    replyMessageId: reply.id,
  });
  recordTurnsIndexedThrough(thread.id, reply.timestamp, Date.now());
}

/**
 * Captures the turn `replyMessageId` closed. Memory is never allowed to fail a reply, so a
 * storage error is logged and the next launch's catch-up captures the turn.
 */
export function publishConversationTurnMemory(
  conversationId: string,
  replyMessageId: string,
  conversations: ReadonlyArray<CaptureThread> = currentConversations(),
): void {
  if (!isMemoryOn()) return;
  const thread = conversations.find((candidate) => candidate.id === conversationId);
  if (!thread || thread.isSideThread) return;
  const reply = thread.messages.find((message) => message.id === replyMessageId);
  if (!reply || !isClosedReply(reply)) return;
  try {
    captureTurn(thread, reply);
  } catch (error) {
    logger.warn('Could not index the closed turn.', { error: String(error) });
  }
  scheduleMemoryExtraction(thread.id, reply.id);
}

/** Captures every turn closed since each thread's cursor: those a killed app never captured. */
export function catchUpMemoryCapture(conversations: ReadonlyArray<CaptureThread>): void {
  if (!isMemoryOn()) return;
  for (const thread of conversations) {
    if (thread.isSideThread) continue;
    try {
      const cursor = readCaptureCursor(thread.id);
      let lastClosed: Message | null = null;
      for (const message of thread.messages) {
        if (!isClosedReply(message)) continue;
        lastClosed = message;
        if (message.timestamp > (cursor?.indexedThroughAt ?? 0)) {
          captureTurn(thread, message);
        }
      }
      if (lastClosed && lastClosed.id !== cursor?.extractedThroughId) {
        scheduleMemoryExtraction(thread.id, lastClosed.id);
      }
    } catch (error) {
      logger.warn('Could not catch up on a thread.', { error: String(error) });
    }
  }
}

/** Turning memory on: what was said while it was off is never captured. */
export function skipMemoryCaptureToNow(conversations: ReadonlyArray<CaptureThread>): void {
  const now = Date.now();
  for (const thread of conversations) {
    const last = thread.messages[thread.messages.length - 1];
    if (last) skipCaptureThrough(thread.id, last, now);
  }
}

/** Deleting a conversation deletes what memory kept of it. */
export function deleteConversationMemory(conversationId: string): void {
  ensureMemoryCoreSchema(getMemoryDb());
  deleteMemoryItemsFromConversation(conversationId);
  deleteMemoryTurnsFromConversation(conversationId);
  deleteMemoryPromptBuildsFromConversation(conversationId);
  deleteCaptureCursor(conversationId);
}

/**
 * Clearing memory forgets everything it kept — what Kavi saved, its index of earlier
 * exchanges and the prompt log — and stops extraction first, so nothing said before the
 * clear is captured again.
 */
export function clearAllMemory(
  conversations: ReadonlyArray<CaptureThread> = currentConversations(),
): void {
  cancelMemoryExtraction();
  ensureMemoryCoreSchema(getMemoryDb());
  deleteAllMemoryItems();
  deleteAllMemoryTurns();
  deleteAllMemoryPromptBuilds();
  skipMemoryCaptureToNow(conversations);
}

function currentConversations(): ReadonlyArray<CaptureThread> {
  // Late binding keeps the settings and chat stores from importing each other at load time.
  const module =
    require('../../../store/useChatStore') as typeof import('../../../store/useChatStore');
  return module.useChatStore.getState().conversations;
}
