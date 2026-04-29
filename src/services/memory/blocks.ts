// ---------------------------------------------------------------------------
// Kavi — Letta-style memory blocks
// ---------------------------------------------------------------------------
// Tiny, agent-editable, character-capped state buckets. These render into
// every prompt's stable system layer (see services/llm/promptAssembly.ts) so
// total size matters: limits are kept tight on purpose.
// ---------------------------------------------------------------------------

import { getMemoryDb } from './sqlite-store';
import { ensureFactSchema } from './schema';

export interface MemoryBlock {
  label: string;
  content: string;
  charLimit: number;
  description: string;
  pinned: boolean;
  personaId: string | null;
  updatedAt: number;
}

interface BlockRow {
  label: string;
  content: string;
  char_limit: number;
  description: string;
  pinned: number;
  persona_id: string | null;
  updated_at: number;
}

function rowToBlock(row: BlockRow): MemoryBlock {
  return {
    label: row.label,
    content: row.content,
    charLimit: row.char_limit,
    description: row.description,
    pinned: row.pinned !== 0,
    personaId: row.persona_id,
    updatedAt: row.updated_at,
  };
}

/**
 * Default catalog. Char limits are tight: every block goes into every prompt.
 */
export const DEFAULT_MEMORY_BLOCKS: ReadonlyArray<{
  label: string;
  charLimit: number;
  description: string;
  pinned?: boolean;
}> = [
  {
    label: 'profile',
    charLimit: 1500,
    description: 'Stable facts about the user (name, role, location, key preferences).',
    pinned: true,
  },
  {
    label: 'persona',
    charLimit: 1000,
    description: 'How the assistant should behave for the active persona.',
    pinned: true,
  },
  {
    label: 'active_focus',
    charLimit: 800,
    description: 'What the user is working on right now (rolling, refreshed by consolidator).',
  },
  {
    label: 'open_threads',
    charLimit: 800,
    description: 'Unresolved threads / promises / follow-ups (most recent first).',
  },
  {
    label: 'preferences',
    charLimit: 800,
    description: 'Stable user preferences (tone, formatting, do/don\u2019t lists).',
    pinned: true,
  },
];

export class BlockOverflowError extends Error {
  constructor(
    public label: string,
    public charLimit: number,
    public attemptedLength: number,
  ) {
    super(
      `memory_block "${label}" overflow: attempted ${attemptedLength} chars > limit ${charLimit}`,
    );
    this.name = 'BlockOverflowError';
  }
}

export function ensureDefaultBlocks(now = Date.now()): void {
  ensureFactSchema();
  const db = getMemoryDb();
  for (const def of DEFAULT_MEMORY_BLOCKS) {
    const existing = db.getFirstSync<BlockRow>(
      `SELECT * FROM memory_blocks WHERE label = ? LIMIT 1`,
      def.label,
    );
    if (existing) continue;
    db.runSync(
      `INSERT INTO memory_blocks
         (label, content, char_limit, description, pinned, persona_id, updated_at)
         VALUES (?, '', ?, ?, ?, NULL, ?)`,
      def.label,
      def.charLimit,
      def.description,
      def.pinned ? 1 : 0,
      now,
    );
  }
}

export function getBlock(label: string): MemoryBlock | null {
  ensureFactSchema();
  const row = getMemoryDb().getFirstSync<BlockRow>(
    `SELECT * FROM memory_blocks WHERE label = ? LIMIT 1`,
    label,
  );
  return row ? rowToBlock(row) : null;
}

export function listBlocks(): MemoryBlock[] {
  ensureFactSchema();
  const rows = getMemoryDb().getAllSync<BlockRow>(
    `SELECT * FROM memory_blocks ORDER BY pinned DESC, label ASC`,
  );
  return rows.map(rowToBlock);
}

export interface BlockEditOptions {
  /** When true, content is replaced verbatim. Otherwise the new content is appended with a newline. */
  replace?: boolean;
  now?: number;
}

export function editBlock(
  label: string,
  newContent: string,
  options: BlockEditOptions = {},
): MemoryBlock {
  ensureFactSchema();
  const db = getMemoryDb();
  const now = options.now ?? Date.now();
  const existing = db.getFirstSync<BlockRow>(
    `SELECT * FROM memory_blocks WHERE label = ? LIMIT 1`,
    label,
  );
  if (!existing) {
    throw new Error(
      `editBlock: block "${label}" not found. Register it via ensureDefaultBlocks() or upsertBlock() first.`,
    );
  }
  const merged = options.replace
    ? newContent
    : existing.content
      ? `${existing.content}\n${newContent}`.trim()
      : newContent.trim();
  if (merged.length > existing.char_limit) {
    throw new BlockOverflowError(label, existing.char_limit, merged.length);
  }
  db.runSync(
    `UPDATE memory_blocks SET content = ?, updated_at = ? WHERE label = ?`,
    merged,
    now,
    label,
  );
  return rowToBlock({ ...existing, content: merged, updated_at: now });
}

export function upsertBlock(
  block: Omit<MemoryBlock, 'updatedAt'> & { now?: number },
): MemoryBlock {
  ensureFactSchema();
  const db = getMemoryDb();
  const now = block.now ?? Date.now();
  if (block.content.length > block.charLimit) {
    throw new BlockOverflowError(block.label, block.charLimit, block.content.length);
  }
  const existing = db.getFirstSync<BlockRow>(
    `SELECT * FROM memory_blocks WHERE label = ? LIMIT 1`,
    block.label,
  );
  if (existing) {
    db.runSync(
      `UPDATE memory_blocks
         SET content = ?, char_limit = ?, description = ?, pinned = ?, persona_id = ?, updated_at = ?
         WHERE label = ?`,
      block.content,
      block.charLimit,
      block.description,
      block.pinned ? 1 : 0,
      block.personaId,
      now,
      block.label,
    );
  } else {
    db.runSync(
      `INSERT INTO memory_blocks
         (label, content, char_limit, description, pinned, persona_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      block.label,
      block.content,
      block.charLimit,
      block.description,
      block.pinned ? 1 : 0,
      block.personaId,
      now,
    );
  }
  return {
    label: block.label,
    content: block.content,
    charLimit: block.charLimit,
    description: block.description,
    pinned: block.pinned,
    personaId: block.personaId,
    updatedAt: now,
  };
}

export function clearBlock(label: string, now = Date.now()): boolean {
  ensureFactSchema();
  const result = getMemoryDb().runSync(
    `UPDATE memory_blocks SET content = '', updated_at = ? WHERE label = ?`,
    now,
    label,
  );
  return (result.changes ?? 0) > 0;
}
