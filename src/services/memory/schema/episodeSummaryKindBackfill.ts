// ---------------------------------------------------------------------------
// Kavi — One-time `memory_episodes.summary_kind` legacy backfill
// ---------------------------------------------------------------------------
// `summary_kind` was added with a DEFAULT of 'narrative' (see
// `factColumnMigrations.ts`), so every row written before this column existed
// reads back as 'narrative' even when its `summary` is actually our own
// versioned structural-turn descriptor (see `structuralTurnDescriptor.ts`).
// This retags exactly those rows.
//
// This is a structural migration, not a language heuristic: the only check
// performed is the strict versioned parse of our own machine-owned format,
// the same parse the presentation layer uses. Real narrative prose almost
// never parses as that exact shape, and on the rare row where it might, the
// worst outcome is a presentation fallback to the entity/tool list rather
// than any content loss — `summary` itself is never modified.
//
// Idempotent: it only ever touches rows still at the column default, so
// re-running it (once per process, guarded by `ensureFactSchema`'s own
// `schemaReady` flag) is a no-op once every legacy row has been retagged.
// ---------------------------------------------------------------------------

import type { getMemoryDb } from '../database';
import { parseStructuralTurnDescriptor } from '../episodes/structuralTurnDescriptor';

/** Every serialized descriptor is a JSON object, so it always starts with this byte. */
const STRUCTURAL_TURN_DESCRIPTOR_OPENING_DELIMITER = '{';

export function ensureEpisodeSummaryKindBackfill(db: ReturnType<typeof getMemoryDb>): void {
  // The descriptor is a JSON object, so only rows whose summary opens with the
  // object delimiter can possibly parse as one; prose is skipped in SQL rather
  // than paying a failed parse per row on every process start.
  const candidates = db.getAllSync<{ id: string; summary: string }>(
    `SELECT id, summary
       FROM memory_episodes
      WHERE summary_kind = 'narrative'
        AND substr(summary, 1, 1) = ?`,
    STRUCTURAL_TURN_DESCRIPTOR_OPENING_DELIMITER,
  );
  for (const candidate of candidates) {
    if (!parseStructuralTurnDescriptor(candidate.summary)) continue;
    db.runSync(
      `UPDATE memory_episodes
          SET summary_kind = 'structural_turn'
        WHERE id = ? AND summary_kind = 'narrative'`,
      candidate.id,
    );
  }
}
