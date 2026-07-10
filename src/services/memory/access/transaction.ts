import { getSchemaReadyMemoryDb } from './schemaGuard';
import { createLogger } from '../../../utils/logger';

let transactionDepth = 0;
let afterCommitCallbacks: Array<() => void> | null = null;
const logger = createLogger('memory-transaction');

/**
 * Run side effects only after the outermost memory transaction commits.
 * Callers outside a transaction execute immediately.
 */
export function runAfterMemoryTransactionCommit(callback: () => void): void {
  if (transactionDepth === 0) {
    callback();
    return;
  }
  if (!afterCommitCallbacks) {
    throw new Error('memory_transaction_after_commit_queue_missing');
  }
  afterCommitCallbacks.push(callback);
}

function flushAfterCommitCallbacks(callbacks: Array<() => void>): void {
  for (const callback of callbacks) {
    try {
      callback();
    } catch (error) {
      // The database commit is already durable. Notification failures must not
      // turn a committed write into an apparent write failure that callers retry.
      logger.error('Post-commit callback failed.', error);
    }
  }
}

function runSynchronousTransactionCallback<T>(callback: () => T): T {
  const result = callback();
  if (
    result !== null &&
    (typeof result === 'object' || typeof result === 'function') &&
    typeof (result as { then?: unknown }).then === 'function'
  ) {
    throw new Error('memory_transaction_async_callback_not_supported');
  }
  return result;
}

type SynchronousTransactionCallback<Callback extends () => unknown> =
  Extract<ReturnType<Callback>, PromiseLike<unknown>> extends never ? Callback : never;

export function runMemoryTransaction<Callback extends () => unknown>(
  callback: SynchronousTransactionCallback<Callback>,
): ReturnType<Callback>;
export function runMemoryTransaction<T>(callback: () => T): T {
  const db = getSchemaReadyMemoryDb();
  if (transactionDepth > 0) return runSynchronousTransactionCallback(callback);
  afterCommitCallbacks = [];
  const transactional = db as typeof db & { withTransactionSync?: (operation: () => void) => void };
  if (typeof transactional.withTransactionSync === 'function') {
    let result: T | undefined;
    transactionDepth += 1;
    try {
      transactional.withTransactionSync(() => {
        result = runSynchronousTransactionCallback(callback);
      });
    } catch (error) {
      afterCommitCallbacks = null;
      throw error;
    } finally {
      transactionDepth -= 1;
    }
    const callbacks = afterCommitCallbacks;
    afterCommitCallbacks = null;
    if (callbacks) flushAfterCommitCallbacks(callbacks);
    return result as T;
  }
  db.execSync('BEGIN IMMEDIATE TRANSACTION');
  transactionDepth += 1;
  let result: T;
  try {
    result = runSynchronousTransactionCallback(callback);
    db.execSync('COMMIT');
  } catch (error) {
    try {
      db.execSync('ROLLBACK');
    } finally {
      afterCommitCallbacks = null;
      transactionDepth -= 1;
    }
    throw error;
  }
  const callbacks = afterCommitCallbacks;
  afterCommitCallbacks = null;
  transactionDepth -= 1;
  if (callbacks) flushAfterCommitCallbacks(callbacks);
  return result;
}
