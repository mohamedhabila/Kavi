// ---------------------------------------------------------------------------
// Kavi — Memory items store
// ---------------------------------------------------------------------------
// Reads and writes `memory_items`. Kavi is one conversation, so every current (not
// superseded) item applies to every request. Sensitive items (structurally detected personal
// data, or marked sensitive when saved) are kept out of the automatic prompt and returned
// only when the caller asks for them; credentials are refused at write time.
// ---------------------------------------------------------------------------

import type * as SQLite from 'expo-sqlite';
import { getMemoryDb } from '../database';
import { newId } from '../schemaValues';
import { notifyStructuredMemoryChanged } from '../changeNotifications';
import { classifyStructuredMemoryText } from '../memorySensitivityValidators';
import { buildMemoryMatchExpression } from './memoryItemsQuery';
import {
  ensureMemoryCoreSchema,
  MEMORY_ITEM_TEXT_MAX_CHARS,
  runMemoryCoreTransaction,
} from './memorySchema';
import { memoryTextLength } from './memoryText';

export interface MemoryItem {
  id: string;
  text: string;
  pinned: boolean;
  sensitive: boolean;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AddMemoryItemInput {
  text: string;
  /** The conversation the memory was saved from, recorded as its source. */
  conversationId: string;
  pinned?: boolean;
  sensitive?: boolean;
  sourceMessageId?: string | null;
  /** Id of the item this one corrects; an unknown or superseded id is ignored. */
  replaces?: string | null;
  now: number;
}

export type AddMemoryItemResult =
  | { status: 'created'; item: MemoryItem; replacedId: string | null }
  | { status: 'duplicate'; item: MemoryItem }
  | { status: 'restricted' }
  | { status: 'invalid'; reason: 'empty' | 'too_long' };

interface MemoryItemRow {
  id: string;
  text: string;
  pinned: number;
  sensitive: number;
  source_conversation_id: string | null;
  source_message_id: string | null;
  created_at: number;
  updated_at: number;
}

const ITEM_COLUMNS = `i.id, i.text, i.pinned, i.sensitive,
  i.source_conversation_id, i.source_message_id, i.created_at, i.updated_at`;

const CURRENT = 'i.superseded_by IS NULL';

function rowToItem(row: MemoryItemRow): MemoryItem {
  return {
    id: row.id,
    text: row.text,
    pinned: row.pinned === 1,
    sensitive: row.sensitive === 1,
    sourceConversationId: row.source_conversation_id,
    sourceMessageId: row.source_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readyDb(): SQLite.SQLiteDatabase {
  const db = getMemoryDb();
  ensureMemoryCoreSchema(db);
  return db;
}

function findCurrentItem(db: SQLite.SQLiteDatabase, id: string): MemoryItem | null {
  const row = db.getFirstSync<MemoryItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM memory_items i WHERE i.id = ? AND ${CURRENT}`,
    id,
  );
  return row ? rowToItem(row) : null;
}

function findDuplicate(db: SQLite.SQLiteDatabase, text: string): MemoryItem | null {
  const row = db.getFirstSync<MemoryItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM memory_items i WHERE i.text = ? AND ${CURRENT} LIMIT 1`,
    text,
  );
  return row ? rowToItem(row) : null;
}

function normalizeItemText(text: string): string {
  return text.normalize('NFC').trim();
}

function addMemoryItemInTransaction(
  db: SQLite.SQLiteDatabase,
  input: AddMemoryItemInput,
): AddMemoryItemResult {
  const text = normalizeItemText(input.text);
  if (!text) return { status: 'invalid', reason: 'empty' };
  if (memoryTextLength(text) > MEMORY_ITEM_TEXT_MAX_CHARS) {
    return { status: 'invalid', reason: 'too_long' };
  }
  const detected = classifyStructuredMemoryText(text);
  if (detected === 'restricted') return { status: 'restricted' };

  const duplicate = findDuplicate(db, text);
  if (duplicate) {
    if (!input.pinned || duplicate.pinned) return { status: 'duplicate', item: duplicate };
    db.runSync(
      'UPDATE memory_items SET pinned = 1, updated_at = ? WHERE id = ?',
      input.now,
      duplicate.id,
    );
    return { status: 'duplicate', item: { ...duplicate, pinned: true, updatedAt: input.now } };
  }
  const replaced = input.replaces ? findCurrentItem(db, input.replaces) : null;
  const item: MemoryItem = {
    id: newId('mem'),
    text,
    pinned: input.pinned ?? replaced?.pinned ?? false,
    sensitive: input.sensitive === true || detected === 'sensitive',
    sourceConversationId: input.conversationId,
    sourceMessageId: input.sourceMessageId ?? null,
    createdAt: input.now,
    updatedAt: input.now,
  };
  db.runSync(
    `INSERT INTO memory_items (id, text, pinned, sensitive,
       source_conversation_id, source_message_id, superseded_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    item.id,
    item.text,
    item.pinned ? 1 : 0,
    item.sensitive ? 1 : 0,
    item.sourceConversationId,
    item.sourceMessageId,
    item.createdAt,
    item.updatedAt,
  );
  if (replaced) {
    db.runSync(
      'UPDATE memory_items SET superseded_by = ?, updated_at = ? WHERE id = ?',
      item.id,
      input.now,
      replaced.id,
    );
  }
  return { status: 'created', item, replacedId: replaced?.id ?? null };
}

function deleteItemChainInTransaction(db: SQLite.SQLiteDatabase, id: string): number {
  const ids = db
    .getAllSync<{ id: string }>(
      `WITH RECURSIVE chain(id) AS (
         SELECT id FROM memory_items WHERE id = ?
         UNION SELECT m.id FROM memory_items m JOIN chain c ON m.superseded_by = c.id
       )
       SELECT id FROM chain`,
      id,
    )
    .map((row) => row.id);
  let deleted = 0;
  for (const itemId of ids) {
    deleted += db.runSync('DELETE FROM memory_items WHERE id = ?', itemId).changes;
  }
  return deleted;
}

export function addMemoryItem(input: AddMemoryItemInput): AddMemoryItemResult {
  const db = readyDb();
  const result = runMemoryCoreTransaction(db, () => addMemoryItemInTransaction(db, input));
  if (result.status === 'created' || result.status === 'duplicate') {
    notifyStructuredMemoryChanged(input.conversationId);
  }
  return result;
}

/** One memory change proposed by background extraction. */
export type MemoryOperation =
  | { op: 'add'; text: string }
  | { op: 'update'; id: string; text: string }
  | { op: 'delete'; id: string };

/**
 * Applies extraction's operations for one conversation and then `commit` (which advances
 * the extraction cursor), all in one transaction: a crash re-runs the whole window and the
 * window is never applied twice. Operations on pinned memories, which only the user curates,
 * and on memories that are gone or superseded are skipped rather than failing the window.
 */
export function applyMemoryOperations(params: {
  operations: ReadonlyArray<MemoryOperation>;
  conversationId: string;
  sourceMessageId: string | null;
  now: number;
  commit: (db: SQLite.SQLiteDatabase) => void;
}): { added: number; updated: number; deleted: number } {
  const db = readyDb();
  const counts = runMemoryCoreTransaction(db, () => {
    const applied = { added: 0, updated: 0, deleted: 0 };
    for (const operation of params.operations) {
      if (operation.op === 'add') {
        const result = addMemoryItemInTransaction(db, {
          text: operation.text,
          conversationId: params.conversationId,
          sourceMessageId: params.sourceMessageId,
          now: params.now,
        });
        if (result.status === 'created') applied.added += 1;
        continue;
      }
      const target = findCurrentItem(db, operation.id);
      if (!target || target.pinned) continue;
      if (operation.op === 'update') {
        const result = addMemoryItemInTransaction(db, {
          text: operation.text,
          conversationId: params.conversationId,
          sensitive: target.sensitive,
          sourceMessageId: params.sourceMessageId,
          replaces: target.id,
          now: params.now,
        });
        if (result.status === 'created') applied.updated += 1;
        continue;
      }
      applied.deleted += deleteItemChainInTransaction(db, target.id) > 0 ? 1 : 0;
    }
    params.commit(db);
    return applied;
  });
  if (counts.added + counts.updated + counts.deleted > 0) {
    notifyStructuredMemoryChanged(params.conversationId);
  }
  return counts;
}

export function searchMemoryItems(params: {
  query: string;
  limit: number;
  includeSensitive: boolean;
}): MemoryItem[] {
  const match = buildMemoryMatchExpression(params.query);
  if (!match || params.limit <= 0) return [];
  const rows = readyDb().getAllSync<MemoryItemRow>(
    `SELECT ${ITEM_COLUMNS}
       FROM memory_items_fts f
       JOIN memory_items i ON i.rowid = f.rowid
      WHERE memory_items_fts MATCH ?
        AND ${CURRENT}
        AND (? = 1 OR i.sensitive = 0)
      ORDER BY bm25(memory_items_fts), i.updated_at DESC
      LIMIT ?`,
    match,
    params.includeSensitive ? 1 : 0,
    params.limit,
  );
  return rows.map(rowToItem);
}

export function listPinnedMemoryItems(params: {
  limit: number;
  includeSensitive: boolean;
}): MemoryItem[] {
  const rows = readyDb().getAllSync<MemoryItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM memory_items i
      WHERE i.pinned = 1 AND ${CURRENT} AND (? = 1 OR i.sensitive = 0)
      ORDER BY i.updated_at DESC
      LIMIT ?`,
    params.includeSensitive ? 1 : 0,
    params.limit,
  );
  return rows.map(rowToItem);
}

/** Every current item, newest first, for the memory screen. */
export function listMemoryItems(params: { limit: number; offset: number }): MemoryItem[] {
  return readyDb()
    .getAllSync<MemoryItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM memory_items i
        WHERE ${CURRENT}
        ORDER BY i.updated_at DESC
        LIMIT ? OFFSET ?`,
      params.limit,
      params.offset,
    )
    .map(rowToItem);
}

export function getMemoryItem(id: string): MemoryItem | null {
  const row = readyDb().getFirstSync<MemoryItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM memory_items i WHERE i.id = ?`,
    id,
  );
  return row ? rowToItem(row) : null;
}

/** The item when it is current (not superseded), else null. */
export function getCurrentMemoryItem(id: string): MemoryItem | null {
  return findCurrentItem(readyDb(), id);
}

/** Deletes the item and everything it superseded. Returns whether anything was deleted. */
export function forgetMemoryItem(id: string): boolean {
  const db = readyDb();
  const deleted = runMemoryCoreTransaction(db, () => deleteItemChainInTransaction(db, id));
  if (deleted > 0) notifyStructuredMemoryChanged();
  return deleted > 0;
}

export function setMemoryItemPinned(id: string, pinned: boolean, now: number): boolean {
  const changed = readyDb().runSync(
    'UPDATE memory_items SET pinned = ?, updated_at = ? WHERE id = ? AND superseded_by IS NULL',
    pinned ? 1 : 0,
    now,
    id,
  ).changes;
  if (changed > 0) notifyStructuredMemoryChanged();
  return changed > 0;
}

/**
 * Deleting a conversation deletes what was remembered in it, each with the history it
 * superseded (as forgetting does), so no remaining item points at a deleted correction.
 */
export function deleteMemoryItemsFromConversation(conversationId: string): number {
  const db = readyDb();
  const deleted = runMemoryCoreTransaction(db, () => {
    const ids = db
      .getAllSync<{
        id: string;
      }>('SELECT id FROM memory_items WHERE source_conversation_id = ?', conversationId)
      .map((row) => row.id);
    let count = 0;
    for (const id of ids) count += deleteItemChainInTransaction(db, id);
    return count;
  });
  if (deleted > 0) notifyStructuredMemoryChanged(conversationId);
  return deleted;
}

export function deleteAllMemoryItems(): void {
  readyDb().runSync('DELETE FROM memory_items');
  notifyStructuredMemoryChanged();
}
