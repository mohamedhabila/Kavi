// ---------------------------------------------------------------------------
// Kavi — Background memory extraction for one chat thread
// ---------------------------------------------------------------------------
// The capture cursor records the last indexed turn extraction has read. One run takes the
// turns indexed after it, shows the model those rounds plus the stored memories they may
// touch, and applies the add/update/delete operations it returns together with the cursor
// advance, in one transaction (mem0's extract-then-update pipeline, LangMem's background
// manager). Rounds come from the past-turn index rather than the thread, so a round that
// left the thread's live messages (the message cap, a context reset) is still extracted.
// Sensitive memories are shown too, so extraction updates them instead of storing a
// duplicate; the conversation text already goes to the same provider.
//
// Model-checked (docs/formal/MemoryCapture.tla): a window is applied at most once even
// with concurrent drains, a foreground turn preempting a run costs nothing, and every turn
// closed with memory on is eventually indexed and extracted, also when it leaves the live
// thread first. Only real failures count; after MAX_EXTRACTION_FAILURES the window is
// skipped so one bad window never blocks the thread's later turns.
// ---------------------------------------------------------------------------

import { getMemoryDb } from '../database';
import {
  readCaptureCursor,
  recordExtractedThrough,
  recordExtractionFailure,
} from './memoryCaptureCursor';
import { ensureMemoryCoreSchema } from './memorySchema';
import { applyMemoryOperations, searchMemoryItems, type MemoryOperation } from './memoryItemsStore';
import {
  MEMORY_EXTRACTION_MAX_OPERATIONS,
  type MemoryExtractionCall,
} from './memoryExtractionModel';
import { boundMemoryText } from './memoryText';
import { listMemoryTurnsAfter, type MemoryTurn } from './memoryTurnsStore';

export const MAX_EXTRACTION_FAILURES = 3;
const EXTRACTION_WINDOW_MAX_ROUNDS = 4;
const RELATED_MEMORY_LIMIT = 10;
const ROUND_TEXT_MAX_CHARS = 4_000;

export type MemoryExtractionOutcome =
  | { kind: 'idle' }
  | { kind: 'extracted'; added: number; updated: number; deleted: number }
  | { kind: 'preempted' }
  | { kind: 'failed'; failures: number }
  | { kind: 'skipped' };

interface ExtractionWindow {
  /** Rounds for the model to read; empty when every round in the window managed its own memory. */
  rounds: string[];
  userText: string;
  /** When the window's last turn closed: the cursor moves there once the window is applied. */
  throughAt: number;
  lastUserMessageId: string | null;
}

/**
 * The window over `turns`, the next indexed turns after the cursor, oldest first. A round in
 * which the assistant saved or forgot a memory itself is passed over: the window still moves
 * past it, but its text is not shown to the model.
 */
export function selectExtractionWindow(turns: ReadonlyArray<MemoryTurn>): ExtractionWindow | null {
  const last = turns[turns.length - 1];
  if (!last) return null;
  const shown = turns.filter((turn) => !turn.managesMemory);
  return {
    rounds: shown.map((turn) => boundMemoryText(turn.text, ROUND_TEXT_MAX_CHARS)),
    userText: shown.map((turn) => turn.userText).join('\n'),
    throughAt: last.at,
    lastUserMessageId: shown[shown.length - 1]?.userMessageId ?? null,
  };
}

export function buildExtractionPrompt(
  rounds: ReadonlyArray<string>,
  related: ReadonlyArray<{ id: string; text: string }>,
): string {
  const memories = related.length
    ? related.map((item) => `- ${item.id}: ${item.text}`).join('\n')
    : '(none)';
  return `You keep the long-term memory of a personal assistant.

Stored memories that may relate (id: text):
${memories}

New conversation:
${rounds.join('\n\n')}

Return the memory operations this conversation calls for:
- add: a lasting fact, preference, plan, decision or person the user shared that is not stored yet. Write one self-contained statement in the user's language that names who or what it is about.
- update: a stored memory that changed; give its id and the full corrected statement.
- delete: a stored memory the user said is no longer true; give its id.
Skip small talk, questions, the assistant's own suggestions and anything already stored. Never store passwords, API keys or tokens. Return no operations when nothing is worth remembering.
Each operation is {"op": "add" | "update" | "delete", "id": the stored memory's id (null for add), "text": the memory statement itself (null for delete)}.`;
}

class MemoryExtractionReplyInvalid extends Error {
  constructor() {
    super('memory_extraction_reply_invalid');
  }
}

/** The operations in a reply. A malformed reply throws; a malformed single operation is dropped. */
export function parseExtractionReply(reply: string): MemoryOperation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    throw new MemoryExtractionReplyInvalid();
  }
  const operations = (parsed as { operations?: unknown } | null)?.operations;
  if (!Array.isArray(operations)) throw new MemoryExtractionReplyInvalid();
  const result: MemoryOperation[] = [];
  for (const raw of operations.slice(0, MEMORY_EXTRACTION_MAX_OPERATIONS)) {
    if (!raw || typeof raw !== 'object') continue;
    const { op, id, text } = raw as { op?: unknown; id?: unknown; text?: unknown };
    const hasId = typeof id === 'string' && id.trim().length > 0;
    const hasText = typeof text === 'string' && text.trim().length > 0;
    if (op === 'add' && hasText) result.push({ op, text: text as string });
    else if (op === 'update' && hasId && hasText) {
      result.push({ op, id: (id as string).trim(), text: text as string });
    } else if (op === 'delete' && hasId) result.push({ op, id: (id as string).trim() });
  }
  return result;
}

export async function extractConversationMemory(params: {
  conversationId: string;
  call: MemoryExtractionCall;
  signal: AbortSignal;
  now: () => number;
}): Promise<MemoryExtractionOutcome> {
  const db = getMemoryDb();
  ensureMemoryCoreSchema(db);
  const cursor = readCaptureCursor(params.conversationId, db);
  const window = selectExtractionWindow(
    listMemoryTurnsAfter(
      {
        conversationId: params.conversationId,
        afterAt: cursor?.extractedThroughAt ?? 0,
        limit: EXTRACTION_WINDOW_MAX_ROUNDS,
      },
      db,
    ),
  );
  if (!window) return { kind: 'idle' };
  if (window.rounds.length === 0) {
    // The assistant managed these rounds' memory itself: move past them without a call.
    recordExtractedThrough(db, params.conversationId, window.throughAt, params.now());
    return { kind: 'extracted', added: 0, updated: 0, deleted: 0 };
  }

  const related = searchMemoryItems({
    query: window.userText,
    limit: RELATED_MEMORY_LIMIT,
    includeSensitive: true,
  });
  let operations: MemoryOperation[];
  try {
    operations = parseExtractionReply(
      await params.call(
        buildExtractionPrompt(window.rounds, related),
        params.signal,
        params.conversationId,
      ),
    );
  } catch {
    // A preempted call is not a failure; anything else (provider error, malformed reply) is.
    if (params.signal.aborted) return { kind: 'preempted' };
    const now = params.now();
    const failures = (cursor?.extractionFailures ?? 0) + 1;
    if (failures >= MAX_EXTRACTION_FAILURES) {
      recordExtractedThrough(db, params.conversationId, window.throughAt, now);
      return { kind: 'skipped' };
    }
    recordExtractionFailure(db, params.conversationId, failures, now);
    return { kind: 'failed', failures };
  }
  if (params.signal.aborted) return { kind: 'preempted' };

  const now = params.now();
  const counts = applyMemoryOperations({
    operations,
    conversationId: params.conversationId,
    sourceMessageId: window.lastUserMessageId,
    now,
    commit: (transactionDb) =>
      recordExtractedThrough(transactionDb, params.conversationId, window.throughAt, now),
  });
  return { kind: 'extracted', ...counts };
}
