import { runMemoryTransaction } from '../src/services/memory/access/transaction';

const synchronousResult = runMemoryTransaction(() => ({ status: 'committed' as const }));
const exactSynchronousResult: { status: 'committed' } = synchronousResult;
void exactSynchronousResult;

// @ts-expect-error Async callbacks can commit before their work finishes.
runMemoryTransaction(async () => 'unsafe');

const maybeAsyncCallback = (): string | Promise<string> => 'sync-this-time';
// @ts-expect-error A union containing a Promise is not a safe synchronous contract.
runMemoryTransaction(maybeAsyncCallback);
