import { getMany, getOne, runMemoryStatement } from './access/crud';
import type { MigrationErrorCode, MigrationStatus } from './migrationStateSchema';

export interface MigrationStateRow {
  conversationId: string;
  lastSeededMessageId: string | null;
  seededTurns: number;
  status: MigrationStatus;
  error: MigrationErrorCode | null;
  claimExpiresAt: number | null;
  updatedAt: number;
}

interface MigrationStateRowDb {
  conversation_id: string;
  last_seeded_message_id: string | null;
  seeded_turns: number;
  status: string;
  error: string | null;
  claim_token: string | null;
  claim_expires_at: number | null;
  updated_at: number;
}

function rowToState(row: MigrationStateRowDb): MigrationStateRow {
  return {
    conversationId: row.conversation_id,
    lastSeededMessageId: row.last_seeded_message_id,
    seededTurns: row.seeded_turns,
    status: row.status as MigrationStatus,
    error: row.error as MigrationErrorCode | null,
    claimExpiresAt: row.claim_expires_at,
    updatedAt: row.updated_at,
  };
}

export function getMigrationState(conversationId: string): MigrationStateRow | null {
  const row = getOne<MigrationStateRowDb>(
    `SELECT * FROM memory_migration_state WHERE conversation_id = ? LIMIT 1`,
    conversationId,
  );
  return row ? rowToState(row) : null;
}

export function listMigrationStates(): MigrationStateRow[] {
  return getMany<MigrationStateRowDb>(
    `SELECT * FROM memory_migration_state ORDER BY updated_at DESC`,
  ).map(rowToState);
}

export function clearMigrationState(conversationId: string): void {
  runMemoryStatement(
    `DELETE FROM memory_migration_state WHERE conversation_id = ?`,
    conversationId,
  );
}
