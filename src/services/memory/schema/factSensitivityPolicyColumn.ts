import type { MemoryDatabase } from '../access/schemaGuard';

/** Add the fail-closed marker to databases created before policy versioning. */
export function ensureFactSensitivityPolicyColumn(db: MemoryDatabase): void {
  const columns = db.getAllSync<{ name: string }>('PRAGMA table_info(memory_facts)');
  if (columns.some((column) => column.name === 'sensitivity_policy_version')) return;
  db.execSync(
    'ALTER TABLE memory_facts ADD COLUMN sensitivity_policy_version INTEGER NOT NULL DEFAULT 0',
  );
}
