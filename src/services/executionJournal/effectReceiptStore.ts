import type * as SQLite from 'expo-sqlite';

import { digestToolEffectText } from '../../engine/toolExecution/toolEffectReceipt';
import type { ToolEffectReceipt } from '../../types/toolEffectReceipt';
import { decodeToolEffectReceipt } from '../../utils/toolEffectReceipt';

const DIGEST_PREFIX = 'sha256:';
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

type StoredReceiptRow = {
  receipt_id: unknown;
  receipt_digest: unknown;
  receipt_json: unknown;
  recorded_at: unknown;
  persisted_at: unknown;
};

export type PreparedEffectReceiptRecord = Readonly<{
  receipt: ToolEffectReceipt;
  receiptDigest: string;
  receiptJson: string;
}>;

export type StoredEffectReceiptRecord = PreparedEffectReceiptRecord &
  Readonly<{ persistedAt: number }>;

function stripDigestPrefix(value: `sha256:${string}`): string {
  return value.slice(DIGEST_PREFIX.length);
}

function canonicalReceiptJson(receipt: ToolEffectReceipt): string {
  const decoded = decodeToolEffectReceipt(receipt);
  if (!decoded) throw new Error('effect_dispatch_receipt_invalid');
  return JSON.stringify(decoded);
}

export async function prepareEffectReceiptRecord(
  receipt: ToolEffectReceipt,
): Promise<PreparedEffectReceiptRecord> {
  const canonicalReceipt = decodeToolEffectReceipt(receipt);
  if (!canonicalReceipt) throw new Error('effect_dispatch_receipt_invalid');
  const receiptJson = canonicalReceiptJson(canonicalReceipt);
  const receiptDigest = stripDigestPrefix(await digestToolEffectText(receiptJson));
  return Object.freeze({ receipt: canonicalReceipt, receiptDigest, receiptJson });
}

export function readStoredEffectReceipt(
  database: SQLite.SQLiteDatabase,
  runId: string,
  effectId: string,
): StoredEffectReceiptRecord | null {
  const row = database.getFirstSync<StoredReceiptRow>(
    `SELECT receipt_id, receipt_digest, receipt_json, recorded_at, persisted_at
       FROM execution_effect_receipts
      WHERE run_id = ? AND effect_id = ?`,
    runId,
    effectId,
  );
  if (!row) return null;
  if (
    typeof row.receipt_id !== 'string' ||
    typeof row.receipt_digest !== 'string' ||
    !DIGEST_PATTERN.test(row.receipt_digest) ||
    typeof row.receipt_json !== 'string' ||
    !Number.isSafeInteger(row.recorded_at) ||
    !Number.isSafeInteger(row.persisted_at) ||
    (row.recorded_at as number) < 0 ||
    (row.persisted_at as number) < (row.recorded_at as number)
  ) {
    throw new Error('effect_dispatch_receipt_row_invalid');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.receipt_json);
  } catch {
    throw new Error('effect_dispatch_receipt_json_invalid');
  }
  const receipt = decodeToolEffectReceipt(parsed);
  if (
    !receipt ||
    receipt.receiptId !== row.receipt_id ||
    receipt.recordedAt !== row.recorded_at ||
    canonicalReceiptJson(receipt) !== row.receipt_json
  ) {
    throw new Error('effect_dispatch_receipt_payload_invalid');
  }
  return Object.freeze({
    receipt,
    receiptDigest: row.receipt_digest,
    receiptJson: row.receipt_json,
    persistedAt: row.persisted_at as number,
  });
}

export async function readVerifiedStoredEffectReceipt(
  database: SQLite.SQLiteDatabase,
  runId: string,
  effectId: string,
): Promise<StoredEffectReceiptRecord | null> {
  const stored = readStoredEffectReceipt(database, runId, effectId);
  if (!stored) return null;
  const actualDigest = stripDigestPrefix(await digestToolEffectText(stored.receiptJson));
  if (actualDigest !== stored.receiptDigest) {
    throw new Error('effect_dispatch_receipt_digest_mismatch');
  }
  return stored;
}

export function insertEffectReceipt(
  database: SQLite.SQLiteDatabase,
  input: PreparedEffectReceiptRecord & {
    runId: string;
    effectId: string;
    persistedAt: number;
  },
): 'recorded' | 'replayed' | 'conflict' {
  const existing = readStoredEffectReceipt(database, input.runId, input.effectId);
  if (existing) {
    return existing.receiptDigest === input.receiptDigest &&
      existing.receiptJson === input.receiptJson &&
      existing.receipt.receiptId === input.receipt.receiptId
      ? 'replayed'
      : 'conflict';
  }
  if (!Number.isSafeInteger(input.persistedAt) || input.persistedAt < input.receipt.recordedAt) {
    throw new Error('effect_dispatch_receipt_persistence_time_invalid');
  }
  const inserted = database.runSync(
    `INSERT INTO execution_effect_receipts (
       receipt_id, run_id, effect_id, receipt_digest, receipt_json, recorded_at, persisted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    input.receipt.receiptId,
    input.runId,
    input.effectId,
    input.receiptDigest,
    input.receiptJson,
    input.receipt.recordedAt,
    input.persistedAt,
  );
  if (inserted.changes !== 1) {
    throw new Error('effect_dispatch_receipt_insert_failed');
  }
  return 'recorded';
}
