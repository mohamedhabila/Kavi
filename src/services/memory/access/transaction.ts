import { getSchemaReadyMemoryDb } from './schemaGuard';

export function runMemoryTransaction<T>(callback: () => T): T {
  const db = getSchemaReadyMemoryDb();
  const transactional = db as typeof db & { withTransactionSync?: (operation: () => void) => void };
  if (typeof transactional.withTransactionSync === 'function') {
    let result: T | undefined;
    transactional.withTransactionSync(() => {
      result = callback();
    });
    return result as T;
  }
  return callback();
}
