import type { MemoryDatabase } from './access/schemaGuard';
import { isExactMemoryScopeId } from './memoryScopeIdentity';

interface VaultIdentityRow {
  owner_id: string;
}

interface VaultIdentityColumnRow {
  name: string;
}

function requireVaultTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('memory_vault_timestamp_invalid');
  }
  return value;
}

export function ensureMemoryVaultIdentitySchema(db: MemoryDatabase, now = Date.now()): void {
  const createdAt = requireVaultTimestamp(now);
  db.execSync(`
    CREATE TABLE IF NOT EXISTS memory_vault_identity (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      owner_id TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL CHECK(created_at >= 0),
      restrictive_authority_revision INTEGER NOT NULL DEFAULT 0
        CHECK(restrictive_authority_revision BETWEEN 0 AND 9007199254740991),
      projection_revision INTEGER NOT NULL DEFAULT 0
        CHECK(projection_revision BETWEEN 0 AND 9007199254740991),
      memory_policy_enabled INTEGER NOT NULL DEFAULT 1
        CHECK(memory_policy_enabled IN (0, 1)),
      memory_policy_revision INTEGER NOT NULL DEFAULT 0
        CHECK(memory_policy_revision BETWEEN 0 AND 9007199254740991),
      CHECK(projection_revision >= restrictive_authority_revision)
    );
  `);
  const columns = db.getAllSync<VaultIdentityColumnRow>('PRAGMA table_info(memory_vault_identity)');
  if (!columns.some((column) => column.name === 'restrictive_authority_revision')) {
    db.execSync(
      `ALTER TABLE memory_vault_identity
         ADD COLUMN restrictive_authority_revision INTEGER NOT NULL DEFAULT 0
           CHECK(restrictive_authority_revision BETWEEN 0 AND 9007199254740991)`,
    );
  }
  if (!columns.some((column) => column.name === 'projection_revision')) {
    db.execSync(
      `ALTER TABLE memory_vault_identity
         ADD COLUMN projection_revision INTEGER NOT NULL DEFAULT 0
           CHECK(projection_revision BETWEEN 0 AND 9007199254740991)`,
    );
  }
  if (!columns.some((column) => column.name === 'memory_policy_enabled')) {
    db.execSync(
      `ALTER TABLE memory_vault_identity
         ADD COLUMN memory_policy_enabled INTEGER NOT NULL DEFAULT 1
           CHECK(memory_policy_enabled IN (0, 1))`,
    );
  }
  if (!columns.some((column) => column.name === 'memory_policy_revision')) {
    db.execSync(
      `ALTER TABLE memory_vault_identity
         ADD COLUMN memory_policy_revision INTEGER NOT NULL DEFAULT 0
           CHECK(memory_policy_revision BETWEEN 0 AND 9007199254740991)`,
    );
  }
  db.runSync(
    `INSERT OR IGNORE INTO memory_vault_identity(singleton, owner_id, created_at)
     VALUES (1, 'vault_owner_' || lower(hex(randomblob(16))), ?)`,
    createdAt,
  );
  getLocalMemoryVaultOwnerId(db);
}

export function getLocalMemoryVaultOwnerId(db: MemoryDatabase): string {
  const rows = db.getAllSync<VaultIdentityRow>(
    'SELECT owner_id FROM memory_vault_identity WHERE singleton = 1',
  );
  if (rows.length !== 1 || !isExactMemoryScopeId(rows[0].owner_id)) {
    throw new Error('memory_vault_identity_invalid');
  }
  return rows[0].owner_id;
}
