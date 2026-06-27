import { getSchemaReadyMemoryDb } from './schemaGuard';

let transactionDepth = 0;

export function runMemoryTransaction<T>(callback: () => T): T {
  const db = getSchemaReadyMemoryDb();
  if (transactionDepth > 0) return callback();
  const transactional = db as typeof db & { withTransactionSync?: (operation: () => void) => void };
  if (typeof transactional.withTransactionSync === 'function') {
    let result: T | undefined;
    transactionDepth += 1;
    try {
      transactional.withTransactionSync(() => {
        result = callback();
      });
    } finally {
      transactionDepth -= 1;
    }
    return result as T;
  }
  db.execSync('BEGIN IMMEDIATE TRANSACTION');
  transactionDepth += 1;
  try {
    const result = callback();
    db.execSync('COMMIT');
    return result;
  } catch (error) {
    try {
      db.execSync('ROLLBACK');
    } finally {
      transactionDepth -= 1;
    }
    throw error;
  } finally {
    if (transactionDepth > 0) transactionDepth -= 1;
  }
}
