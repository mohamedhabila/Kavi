// ---------------------------------------------------------------------------
// Kavi — E2E evidence: memory items and what each turn's prompt showed
// ---------------------------------------------------------------------------
// Evaluation-only reads of the product's memory store. A turn's capture brackets the
// prompt-log rows the turn's requests wrote; the final state lists every item, current or
// replaced, so rubrics can check what was remembered and what a correction superseded.
// ---------------------------------------------------------------------------

import { getMemoryDb } from '../../services/memory/database';
import { ensureMemoryCoreSchema } from '../../services/memory/core/memorySchema';
import {
  latestMemoryPromptBuildId,
  listMemoryPromptBuilds,
} from '../../services/memory/core/memoryPromptLog';

export type ForegroundScenarioMemoryPromptEvidence = Readonly<{
  status: 'recorded' | 'missing' | 'opt_out';
  builds: ReadonlyArray<
    Readonly<{
      itemIds: ReadonlyArray<string>;
      turnIds: ReadonlyArray<string>;
      chars: number;
      durationMs: number;
    }>
  >;
}>;

export type ForegroundScenarioMemoryItemRecord = Readonly<{
  id: string;
  text: string;
  scope: 'global' | 'conversation';
  pinned: boolean;
  sensitive: boolean;
  supersededBy: string | null;
  createdAt: number;
  updatedAt: number;
}>;

export type ForegroundScenarioMemoryItemsState = Readonly<{
  capturedAt: number;
  items: ReadonlyArray<ForegroundScenarioMemoryItemRecord>;
}>;

export type ForegroundScenarioMemoryPromptCapture = Readonly<{
  afterId: number;
  memoryOptOut: boolean;
}>;

export function beginForegroundScenarioMemoryPromptCapture(input: {
  memoryOptOut: boolean;
}): ForegroundScenarioMemoryPromptCapture {
  return {
    afterId: input.memoryOptOut ? 0 : latestMemoryPromptBuildId(),
    memoryOptOut: input.memoryOptOut,
  };
}

export function completeForegroundScenarioMemoryPromptCapture(input: {
  capture: ForegroundScenarioMemoryPromptCapture;
  memoryConversationId: string;
}): ForegroundScenarioMemoryPromptEvidence {
  if (input.capture.memoryOptOut) return { status: 'opt_out', builds: [] };
  const builds = listMemoryPromptBuilds({
    conversationId: input.memoryConversationId,
    afterId: input.capture.afterId,
  }).map(({ itemIds, turnIds, chars, durationMs }) => ({ itemIds, turnIds, chars, durationMs }));
  return { status: builds.length > 0 ? 'recorded' : 'missing', builds };
}

interface MemoryItemEvidenceRow {
  id: string;
  text: string;
  scope: 'global' | 'conversation';
  pinned: number;
  sensitive: number;
  superseded_by: string | null;
  created_at: number;
  updated_at: number;
}

/** Every item in the isolated evaluation store, oldest first. */
export function captureForegroundScenarioMemoryItems(
  now: number = Date.now(),
): ForegroundScenarioMemoryItemsState {
  const db = getMemoryDb();
  ensureMemoryCoreSchema(db);
  const items = db
    .getAllSync<MemoryItemEvidenceRow>(
      `SELECT id, text, scope, pinned, sensitive, superseded_by, created_at, updated_at
         FROM memory_items ORDER BY created_at, id`,
    )
    .map((row) => ({
      id: row.id,
      text: row.text,
      scope: row.scope,
      pinned: row.pinned === 1,
      sensitive: row.sensitive === 1,
      supersededBy: row.superseded_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  return { capturedAt: now, items };
}
