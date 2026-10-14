// ---------------------------------------------------------------------------
// Kavi — what a LongMemEval history left in the memory store
// ---------------------------------------------------------------------------
// The extract arm's store after extraction read the whole history: how many memories it
// keeps, how many it replaced with a newer statement, and how many current ones say the
// same thing as another (the store filling with repeats instead of updating). Read directly
// from the memory database: this is measurement, not an app path.
// ---------------------------------------------------------------------------

import { getMemoryDb } from '../../services/memory/database';
import { ensureMemoryCoreSchema } from '../../services/memory/core/memorySchema';

export type LongMemEvalMemoryAudit = Readonly<{
  /** Memories in use: not replaced by a newer statement. */
  current: number;
  /** Memories a later statement replaced (an update kept as history). */
  superseded: number;
  /** Current memories whose text, ignoring case, spacing and punctuation, repeats another's. */
  duplicates: number;
}>;

function normalized(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function auditLongMemEvalMemory(): LongMemEvalMemoryAudit {
  const db = getMemoryDb();
  ensureMemoryCoreSchema(db);
  const rows = db.getAllSync<{ text: string; superseded_by: string | null }>(
    'SELECT text, superseded_by FROM memory_items',
  );
  const current = rows.filter((row) => row.superseded_by === null);
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of current) {
    const key = normalized(row.text);
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return {
    current: current.length,
    superseded: rows.length - current.length,
    duplicates,
  };
}
