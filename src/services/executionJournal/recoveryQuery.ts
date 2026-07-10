import * as Crypto from 'expo-crypto';
import type * as SQLite from 'expo-sqlite';
import { getExecutionJournalDb } from './database';
import {
  decodeExecutionCheckpointRow,
  decodeExecutionEffectRow,
  decodeExecutionExternalHandleRow,
  decodeExecutionMonitorRow,
  decodeExecutionRunRow,
} from './decoders';
import {
  planExecutionRecovery,
  type ExecutionJournalSnapshot,
  type ExecutionRecoveryCommand,
} from './recoveryPlanner';
import type {
  ExecutionCheckpointRecord,
  ExecutionEffectRecord,
  ExecutionExternalHandleRecord,
} from './types';

const SNAPSHOT_GENERATION_FORMAT = 'kavi.execution-recovery-snapshot.v1';

export const EXECUTION_RECOVERY_QUERY_BLOCK_REASONS = [
  'invalid_request',
  'run_unavailable',
  'journal_unavailable',
  'malformed_row',
  'mixed_ownership',
  'missing_history',
  'generation_mismatch',
] as const;

export type ExecutionRecoveryQueryBlockReason =
  (typeof EXECUTION_RECOVERY_QUERY_BLOCK_REASONS)[number];

export interface ExecutionRecoveryGeneration {
  controlEpoch: number;
  updatedAt: number;
  snapshotDigest: string;
}

export interface ExecutionRecoveryQueryInput {
  runId: string;
  expectedGeneration?: ExecutionRecoveryGeneration;
}

export type ExecutionRecoveryQueryResult =
  | {
      kind: 'recovery_plan';
      runId: string;
      generation: ExecutionRecoveryGeneration;
      command: ExecutionRecoveryCommand;
    }
  | {
      kind: 'query_blocked';
      runId: string | null;
      generation: null;
      reason: ExecutionRecoveryQueryBlockReason;
    };

class ClosedRecoveryQueryError extends Error {
  constructor(readonly reason: ExecutionRecoveryQueryBlockReason) {
    super(reason);
  }
}

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function isExpectedGeneration(value: unknown): value is ExecutionRecoveryGeneration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const generation = value as Record<string, unknown>;
  return (
    Object.keys(generation).sort().join(',') === 'controlEpoch,snapshotDigest,updatedAt' &&
    Number.isSafeInteger(generation.controlEpoch) &&
    (generation.controlEpoch as number) >= 0 &&
    Number.isSafeInteger(generation.updatedAt) &&
    (generation.updatedAt as number) >= 0 &&
    typeof generation.snapshotDigest === 'string' &&
    /^[a-f0-9]{64}$/u.test(generation.snapshotDigest)
  );
}

function closedResult(
  runId: string | null,
  reason: ExecutionRecoveryQueryBlockReason,
): ExecutionRecoveryQueryResult {
  return { kind: 'query_blocked', runId, generation: null, reason };
}

function readReferencedCheckpoint(
  database: SQLite.SQLiteDatabase,
  checkpointId: string,
): ExecutionCheckpointRecord | null {
  const row = database.getFirstSync<unknown>(
    'SELECT * FROM execution_checkpoints WHERE id = ?',
    checkpointId,
  );
  return row ? decodeExecutionCheckpointRow(row) : null;
}

function readReferencedEffect(
  database: SQLite.SQLiteDatabase,
  effectId: string,
): ExecutionEffectRecord | null {
  const row = database.getFirstSync<unknown>(
    'SELECT * FROM execution_effects WHERE id = ?',
    effectId,
  );
  return row ? decodeExecutionEffectRow(row) : null;
}

function readReferencedHandle(
  database: SQLite.SQLiteDatabase,
  handleId: string,
): ExecutionExternalHandleRecord | null {
  const row = database.getFirstSync<unknown>(
    'SELECT * FROM execution_external_handles WHERE id = ?',
    handleId,
  );
  return row ? decodeExecutionExternalHandleRow(row) : null;
}

function assertClosedSnapshotOwnershipAndHistory(
  database: SQLite.SQLiteDatabase,
  snapshot: ExecutionJournalSnapshot,
): void {
  const { run, checkpoints, effects, externalHandles, monitors } = snapshot;
  if (
    checkpoints.length === 0 ||
    checkpoints[0].sequence !== 0 ||
    checkpoints[0].phase !== 'system' ||
    checkpoints[0].boundary !== 'run_created'
  ) {
    throw new ClosedRecoveryQueryError('missing_history');
  }

  const checkpointIds = new Set<string>();
  for (const [index, checkpoint] of checkpoints.entries()) {
    if (checkpoint.runId !== run.id) {
      throw new ClosedRecoveryQueryError('mixed_ownership');
    }
    if (checkpoint.sequence !== index) {
      throw new ClosedRecoveryQueryError('missing_history');
    }
    checkpointIds.add(checkpoint.id);
  }

  const effectIds = new Set<string>();
  for (const effect of effects) {
    if (effect.runId !== run.id) {
      throw new ClosedRecoveryQueryError('mixed_ownership');
    }
    if (!effect.checkpointId) {
      throw new ClosedRecoveryQueryError('missing_history');
    }
    if (!checkpointIds.has(effect.checkpointId)) {
      const referenced = readReferencedCheckpoint(database, effect.checkpointId);
      throw new ClosedRecoveryQueryError(referenced ? 'mixed_ownership' : 'missing_history');
    }
    effectIds.add(effect.id);
  }

  const handleIds = new Set<string>();
  for (const handle of externalHandles) {
    if (handle.runId !== run.id) {
      throw new ClosedRecoveryQueryError('mixed_ownership');
    }
    if (!effectIds.has(handle.effectId)) {
      const referenced = readReferencedEffect(database, handle.effectId);
      throw new ClosedRecoveryQueryError(referenced ? 'mixed_ownership' : 'missing_history');
    }
    handleIds.add(handle.id);
  }

  const monitorHandleIds = new Set<string>();
  for (const monitor of monitors) {
    if (monitor.runId !== run.id) {
      throw new ClosedRecoveryQueryError('mixed_ownership');
    }
    if (!handleIds.has(monitor.externalHandleId)) {
      const referenced = readReferencedHandle(database, monitor.externalHandleId);
      throw new ClosedRecoveryQueryError(referenced ? 'mixed_ownership' : 'missing_history');
    }
    if (monitorHandleIds.has(monitor.externalHandleId)) {
      throw new ClosedRecoveryQueryError('missing_history');
    }
    monitorHandleIds.add(monitor.externalHandleId);
  }
  if (
    monitorHandleIds.size !== handleIds.size ||
    [...handleIds].some((handleId) => !monitorHandleIds.has(handleId))
  ) {
    throw new ClosedRecoveryQueryError('missing_history');
  }
}

function readRecoverySnapshot(
  database: SQLite.SQLiteDatabase,
  runId: string,
): ExecutionJournalSnapshot | null {
  database.execSync('BEGIN');
  try {
    const rawRun = database.getFirstSync<unknown>(
      'SELECT * FROM execution_runs WHERE id = ?',
      runId,
    );
    if (!rawRun) {
      database.execSync('COMMIT');
      return null;
    }
    const snapshot: ExecutionJournalSnapshot = {
      run: decodeExecutionRunRow(rawRun),
      checkpoints: database
        .getAllSync<unknown>(
          `SELECT * FROM execution_checkpoints
           WHERE run_id = ? ORDER BY sequence ASC, id ASC`,
          runId,
        )
        .map(decodeExecutionCheckpointRow),
      effects: database
        .getAllSync<unknown>(
          `SELECT * FROM execution_effects
           WHERE run_id = ? ORDER BY created_at ASC, id ASC`,
          runId,
        )
        .map(decodeExecutionEffectRow),
      externalHandles: database
        .getAllSync<unknown>(
          `SELECT * FROM execution_external_handles
           WHERE run_id = ? ORDER BY created_at ASC, id ASC`,
          runId,
        )
        .map(decodeExecutionExternalHandleRow),
      monitors: database
        .getAllSync<unknown>(
          `SELECT * FROM execution_monitors
           WHERE run_id = ? ORDER BY created_at ASC, id ASC`,
          runId,
        )
        .map(decodeExecutionMonitorRow),
    };
    assertClosedSnapshotOwnershipAndHistory(database, snapshot);
    database.execSync('COMMIT');
    return snapshot;
  } catch (error) {
    try {
      database.execSync('ROLLBACK');
    } catch {
      // Preserve the original read or decoder failure.
    }
    throw error;
  }
}

async function snapshotGeneration(
  snapshot: ExecutionJournalSnapshot,
): Promise<ExecutionRecoveryGeneration> {
  const canonicalSnapshot = JSON.stringify([SNAPSHOT_GENERATION_FORMAT, snapshot]);
  const snapshotDigest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    canonicalSnapshot,
  );
  if (!/^[a-f0-9]{64}$/u.test(snapshotDigest)) {
    throw new Error('execution_recovery_invalid_snapshot_digest');
  }
  return {
    controlEpoch: snapshot.run.controlEpoch,
    updatedAt: snapshot.run.updatedAt,
    snapshotDigest,
  };
}

function generationsMatch(
  expected: ExecutionRecoveryGeneration,
  actual: ExecutionRecoveryGeneration,
): boolean {
  return (
    expected.controlEpoch === actual.controlEpoch &&
    expected.updatedAt === actual.updatedAt &&
    expected.snapshotDigest === actual.snapshotDigest
  );
}

function isMalformedRowError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('execution_journal_malformed_row:');
}

export async function queryExecutionRecovery(
  input: ExecutionRecoveryQueryInput,
): Promise<ExecutionRecoveryQueryResult> {
  if (!input || !validId(input.runId)) {
    return closedResult(null, 'invalid_request');
  }
  if (input.expectedGeneration !== undefined && !isExpectedGeneration(input.expectedGeneration)) {
    return closedResult(input.runId, 'generation_mismatch');
  }

  let snapshot: ExecutionJournalSnapshot | null;
  try {
    snapshot = readRecoverySnapshot(getExecutionJournalDb(), input.runId);
  } catch (error) {
    if (error instanceof ClosedRecoveryQueryError) {
      return closedResult(input.runId, error.reason);
    }
    return closedResult(
      input.runId,
      isMalformedRowError(error) ? 'malformed_row' : 'journal_unavailable',
    );
  }
  if (!snapshot) {
    return closedResult(input.runId, 'run_unavailable');
  }

  let generation: ExecutionRecoveryGeneration;
  try {
    generation = await snapshotGeneration(snapshot);
  } catch {
    return closedResult(input.runId, 'journal_unavailable');
  }
  if (input.expectedGeneration && !generationsMatch(input.expectedGeneration, generation)) {
    return closedResult(input.runId, 'generation_mismatch');
  }

  return {
    kind: 'recovery_plan',
    runId: snapshot.run.id,
    generation,
    command: planExecutionRecovery(snapshot),
  };
}
