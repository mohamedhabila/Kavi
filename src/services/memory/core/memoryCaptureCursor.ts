// ---------------------------------------------------------------------------
// Kavi — How far memory has read each chat thread
// ---------------------------------------------------------------------------
// One row per thread: the time of the latest closed reply indexed as a past turn, and the
// last message background extraction has read (id and time, so a deleted message does not
// send extraction back to the start) with its consecutive real failures. Turning memory
// on moves both past everything already in the thread, so nothing said while memory was
// off is captured later.
// ---------------------------------------------------------------------------

import type * as SQLite from 'expo-sqlite';
import { getMemoryDb } from '../database';
import { ensureMemoryCoreSchema } from './memorySchema';

export interface MemoryCaptureCursor {
  threadId: string;
  indexedThroughAt: number;
  extractedThroughId: string | null;
  extractedThroughAt: number;
  extractionFailures: number;
}

interface MemoryCaptureCursorRow {
  thread_id: string;
  indexed_through_at: number;
  extracted_through_id: string | null;
  extracted_through_at: number;
  extraction_failures: number;
}

function readyDb(): SQLite.SQLiteDatabase {
  const db = getMemoryDb();
  ensureMemoryCoreSchema(db);
  return db;
}

export function readCaptureCursor(
  threadId: string,
  db: SQLite.SQLiteDatabase = readyDb(),
): MemoryCaptureCursor | null {
  const row = db.getFirstSync<MemoryCaptureCursorRow>(
    `SELECT thread_id, indexed_through_at, extracted_through_id, extracted_through_at,
            extraction_failures
       FROM memory_capture_cursor WHERE thread_id = ?`,
    threadId,
  );
  return row
    ? {
        threadId: row.thread_id,
        indexedThroughAt: row.indexed_through_at,
        extractedThroughId: row.extracted_through_id,
        extractedThroughAt: row.extracted_through_at,
        extractionFailures: row.extraction_failures,
      }
    : null;
}

/** The thread's turns through `at` are indexed; the mark never moves back. */
export function recordTurnsIndexedThrough(threadId: string, at: number, now: number): void {
  readyDb().runSync(
    `INSERT INTO memory_capture_cursor (thread_id, indexed_through_at, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET
         indexed_through_at = max(indexed_through_at, excluded.indexed_through_at),
         updated_at = excluded.updated_at`,
    threadId,
    at,
    now,
  );
}

/** Extraction has read through `message`; inside the transaction that applied its result. */
export function recordExtractedThrough(
  db: SQLite.SQLiteDatabase,
  threadId: string,
  message: { id: string; timestamp: number },
  now: number,
): void {
  db.runSync(
    `INSERT INTO memory_capture_cursor
         (thread_id, extracted_through_id, extracted_through_at, extraction_failures, updated_at)
       VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(thread_id) DO UPDATE SET
         extracted_through_id = excluded.extracted_through_id,
         extracted_through_at = excluded.extracted_through_at,
         extraction_failures = 0,
         updated_at = excluded.updated_at`,
    threadId,
    message.id,
    message.timestamp,
    now,
  );
}

/** One more real extraction failure for the window after the current position. */
export function recordExtractionFailure(
  db: SQLite.SQLiteDatabase,
  threadId: string,
  failures: number,
  now: number,
): void {
  db.runSync(
    `INSERT INTO memory_capture_cursor (thread_id, extraction_failures, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET
         extraction_failures = excluded.extraction_failures,
         updated_at = excluded.updated_at`,
    threadId,
    failures,
    now,
  );
}

/** Moves indexing and extraction past `message`, so nothing before it is ever captured. */
export function skipCaptureThrough(
  threadId: string,
  message: { id: string; timestamp: number },
  now: number,
): void {
  readyDb().runSync(
    `INSERT INTO memory_capture_cursor
         (thread_id, indexed_through_at, extracted_through_id, extracted_through_at,
          extraction_failures, updated_at)
       VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT(thread_id) DO UPDATE SET
         indexed_through_at = max(indexed_through_at, excluded.indexed_through_at),
         extracted_through_id = excluded.extracted_through_id,
         extracted_through_at = excluded.extracted_through_at,
         extraction_failures = 0,
         updated_at = excluded.updated_at`,
    threadId,
    message.timestamp,
    message.id,
    message.timestamp,
    now,
  );
}

export function deleteCaptureCursor(threadId: string): void {
  readyDb().runSync('DELETE FROM memory_capture_cursor WHERE thread_id = ?', threadId);
}
