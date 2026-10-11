// ---------------------------------------------------------------------------
// Kavi — Memory items store
// ---------------------------------------------------------------------------
// Reads and writes `memory_items`. An item is visible to a request when it is current
// (not superseded) and global or owned by the request's conversation. Sensitive items (structurally detected personal data, or marked
// sensitive when saved) are kept out of the automatic prompt and returned only when the
// caller asks for them; credentials are refused at write time.
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

export type MemoryItemScope = 'global' | 'conversation';

export interface MemoryItem {
  id: string;
  text: string;
  scope: MemoryItemScope;
  conversationId: string | null;
  pinned: boolean;
  sensitive: boolean;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Who is asking: conversation-scoped items of other conversations stay invisible. */
export interface MemoryItemVisibility {
  conversationId: string;
}

export interface AddMemoryItemInput {
  text: string;
  scope?: MemoryItemScope;
  conversationId: string;
  pinned?: boolean;
  sensitive?: boolean;
  sourceMessageId?: string | null;
  /** Id of the item this one corrects; an unknown or invisible id is ignored. */
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
  scope: MemoryItemScope;
  conversation_id: string | null;
  pinned: number;
  sensitive: number;
  source_conversation_id: string | null;
  source_message_id: string | null;
  created_at: number;
  updated_at: number;
}

const ITEM_COLUMNS = `i.id, i.text, i.scope, i.conversation_id, i.pinned, i.sensitive,
  i.source_conversation_id, i.source_message_id, i.created_at, i.updated_at`;

const VISIBLE = `i.superseded_by IS NULL
  AND (i.scope = 'global' OR i.conversation_id = ?)`;

function rowToItem(row: MemoryItemRow): MemoryItem {
  return {
    id: row.id,
    text: row.text,
    scope: row.scope,
    conversationId: row.conversation_id,
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

function visibilityParams(visibility: MemoryItemVisibility): [string] {
  return [visibility.conversationId];
}

function findVisibleItem(
  db: SQLite.SQLiteDatabase,
  id: string,
  visibility: MemoryItemVisibility,
): MemoryItem | null {
  const row = db.getFirstSync<MemoryItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM memory_items i WHERE i.id = ? AND ${VISIBLE}`,
    id,
    ...visibilityParams(visibility),
  );
  return row ? rowToItem(row) : null;
}

function findDuplicate(
  db: SQLite.SQLiteDatabase,
  text: string,
  scope: MemoryItemScope,
  visibility: MemoryItemVisibility,
): MemoryItem | null {
  const row = db.getFirstSync<MemoryItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM memory_items i
      WHERE i.text = ? AND i.scope = ? AND ${VISIBLE}
      LIMIT 1`,
    text,
    scope,
    ...visibilityParams(visibility),
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

  const scope = input.scope ?? 'global';
  const visibility = { conversationId: input.conversationId };
  const duplicate = findDuplicate(db, text, scope, visibility);
  if (duplicate) {
    if (!input.pinned || duplicate.pinned) return { status: 'duplicate', item: duplicate };
    db.runSync(
      'UPDATE memory_items SET pinned = 1, updated_at = ? WHERE id = ?',
      input.now,
      duplicate.id,
    );
    return { status: 'duplicate', item: { ...duplicate, pinned: true, updatedAt: input.now } };
  }
  const replaced = input.replaces ? findVisibleItem(db, input.replaces, visibility) : null;
  const item: MemoryItem = {
    id: newId('mem'),
    text,
    scope,
    conversationId: scope === 'conversation' ? input.conversationId : null,
    pinned: input.pinned ?? replaced?.pinned ?? false,
    sensitive: input.sensitive === true || detected === 'sensitive',
    sourceConversationId: input.conversationId,
    sourceMessageId: input.sourceMessageId ?? null,
    createdAt: input.now,
    updatedAt: input.now,
  };
  db.runSync(
    `INSERT INTO memory_items (id, text, scope, conversation_id, pinned, sensitive,
       source_conversation_id, source_message_id, superseded_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    item.id,
    item.text,
    item.scope,
    item.conversationId,
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
 * and on memories `visibility` cannot see are skipped rather than failing the window.
 */
export function applyMemoryOperations(params: {
  operations: ReadonlyArray<MemoryOperation>;
  visibility: MemoryItemVisibility;
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
          conversationId: params.visibility.conversationId,
          sourceMessageId: params.sourceMessageId,
          now: params.now,
        });
        if (result.status === 'created') applied.added += 1;
        continue;
      }
      const target = findVisibleItem(db, operation.id, params.visibility);
      if (!target || target.pinned) continue;
      if (operation.op === 'update') {
        const result = addMemoryItemInTransaction(db, {
          text: operation.text,
          scope: target.scope,
          conversationId: params.visibility.conversationId,
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
    notifyStructuredMemoryChanged(params.visibility.conversationId);
  }
  return counts;
}

export function searchMemoryItems(params: {
  query: string;
  visibility: MemoryItemVisibility;
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
        AND ${VISIBLE}
        AND (? = 1 OR i.sensitive = 0)
      ORDER BY bm25(memory_items_fts), i.updated_at DESC
      LIMIT ?`,
    match,
    ...visibilityParams(params.visibility),
    params.includeSensitive ? 1 : 0,
    params.limit,
  );
  return rows.map(rowToItem);
}

export function listPinnedMemoryItems(params: {
  visibility: MemoryItemVisibility;
  limit: number;
  includeSensitive: boolean;
}): MemoryItem[] {
  const rows = readyDb().getAllSync<MemoryItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM memory_items i
      WHERE i.pinned = 1 AND ${VISIBLE} AND (? = 1 OR i.sensitive = 0)
      ORDER BY i.updated_at DESC
      LIMIT ?`,
    ...visibilityParams(params.visibility),
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
        WHERE i.superseded_by IS NULL
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

/** The item when `visibility` may see it (current and in scope), else null. */
export function getVisibleMemoryItem(
  id: string,
  visibility: MemoryItemVisibility,
): MemoryItem | null {
  return findVisibleItem(readyDb(), id, visibility);
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

/** Deleting a conversation deletes what was remembered in it. */
export function deleteMemoryItemsFromConversation(conversationId: string): number {
  const deleted = readyDb().runSync(
    'DELETE FROM memory_items WHERE source_conversation_id = ? OR conversation_id = ?',
    conversationId,
    conversationId,
  ).changes;
  if (deleted > 0) notifyStructuredMemoryChanged(conversationId);
  return deleted;
}

export function deleteAllMemoryItems(): void {
  readyDb().runSync('DELETE FROM memory_items');
  notifyStructuredMemoryChanged();
}
