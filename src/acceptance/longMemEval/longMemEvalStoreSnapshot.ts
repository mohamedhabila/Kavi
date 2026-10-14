// ---------------------------------------------------------------------------
// Kavi — a LongMemEval question's extracted memory, kept for later arms
// ---------------------------------------------------------------------------
// Extraction is most of an extract-arm run and varies from run to run. Arms that change
// only how memory is retrieved or shown restore the store one run extracted, so they are
// compared on the same memories, in minutes instead of an hour. A restore indexes the
// history's rounds as the memory arm does and re-adds each current memory through the
// store with its own date.
// ---------------------------------------------------------------------------

import { addMemoryItem, listMemoryItems } from '../../services/memory/core/memoryItemsStore';
import type { Message } from '../../types/message';
import { auditLongMemEvalMemory, type LongMemEvalMemoryAudit } from './longMemEvalMemoryAudit';
import { indexLongMemEvalHistory } from './longMemEvalScenario';

/** Far more than one history's memories (LongMemEval_S: at most about a hundred). */
const SNAPSHOT_MAX_ITEMS = 10_000;

export type LongMemEvalStoreSnapshot = Readonly<{
  items: ReadonlyArray<
    Readonly<{ text: string; sensitive: boolean; sourceMessageId: string | null; at: number }>
  >;
  audit: LongMemEvalMemoryAudit;
}>;

export function captureLongMemEvalStore(): LongMemEvalStoreSnapshot {
  return {
    items: listMemoryItems({ limit: SNAPSHOT_MAX_ITEMS, offset: 0 })
      .reverse()
      .map((item) => ({
        text: item.text,
        sensitive: item.sensitive,
        sourceMessageId: item.sourceMessageId,
        at: item.updatedAt,
      })),
    audit: auditLongMemEvalMemory(),
  };
}

export function parseLongMemEvalStoreSnapshot(raw: unknown): LongMemEvalStoreSnapshot {
  const snapshot = raw as Partial<LongMemEvalStoreSnapshot> | null;
  if (!snapshot || !Array.isArray(snapshot.items) || typeof snapshot.audit !== 'object') {
    throw new Error('longmemeval_store_snapshot_invalid');
  }
  return snapshot as LongMemEvalStoreSnapshot;
}

/** Indexes the history and puts the snapshot's memories back; returns how many it added. */
export function restoreLongMemEvalStore(
  conversationId: string,
  messages: ReadonlyArray<Message>,
  snapshot: LongMemEvalStoreSnapshot,
): number {
  indexLongMemEvalHistory(conversationId, messages);
  let added = 0;
  for (const item of snapshot.items) {
    const result = addMemoryItem({
      text: item.text,
      conversationId,
      sensitive: item.sensitive,
      sourceMessageId: item.sourceMessageId,
      now: item.at,
    });
    if (result.status === 'created') added += 1;
  }
  return added;
}
