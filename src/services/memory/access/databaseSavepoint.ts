import type { getMemoryDb } from '../sqlite-store';

type MemoryDatabase = ReturnType<typeof getMemoryDb>;

let nextSavepointId = 0;

export function runMemoryDatabaseSavepoint<T>(
  database: MemoryDatabase,
  operation: (database: MemoryDatabase) => T,
): T {
  nextSavepointId = (nextSavepointId + 1) >>> 0;
  const savepoint = `memory_operation_${nextSavepointId}`;
  database.execSync(`SAVEPOINT ${savepoint}`);
  try {
    const result = operation(database);
    database.execSync(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    try {
      database.execSync(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    } finally {
      database.execSync(`RELEASE SAVEPOINT ${savepoint}`);
    }
    throw error;
  }
}
