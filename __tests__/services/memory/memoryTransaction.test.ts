const mockGetSchemaReadyMemoryDb = jest.fn();

jest.mock('../../../src/services/memory/access/schemaGuard', () => ({
  getSchemaReadyMemoryDb: () => mockGetSchemaReadyMemoryDb(),
}));

import {
  runAfterMemoryTransactionCommit,
  runMemoryTransaction,
} from '../../../src/services/memory/access/transaction';

interface FakeMemoryDb {
  execSync: jest.Mock;
  withTransactionSync?: (operation: () => void) => void;
}

function useManualAdapter(events: string[]): FakeMemoryDb {
  const db: FakeMemoryDb = {
    execSync: jest.fn((statement: string) => {
      if (statement.startsWith('BEGIN')) events.push('begin');
      if (statement === 'COMMIT') events.push('commit');
      if (statement === 'ROLLBACK') events.push('rollback');
    }),
  };
  mockGetSchemaReadyMemoryDb.mockReturnValue(db);
  return db;
}

function useNativeAdapter(events: string[]): FakeMemoryDb {
  const db: FakeMemoryDb = {
    execSync: jest.fn(),
    withTransactionSync: (operation) => {
      events.push('begin');
      try {
        operation();
        events.push('commit');
      } catch (error) {
        events.push('rollback');
        throw error;
      }
    },
  };
  mockGetSchemaReadyMemoryDb.mockReturnValue(db);
  return db;
}

beforeEach(() => {
  mockGetSchemaReadyMemoryDb.mockReset();
});

describe('memory transaction after-commit effects', () => {
  it('runs a manual-adapter callback only after commit', () => {
    const events: string[] = [];
    useManualAdapter(events);

    const result = runMemoryTransaction(() => {
      events.push('write');
      runAfterMemoryTransactionCommit(() => events.push('after_commit'));
      return 'committed';
    });

    expect(result).toBe('committed');
    expect(events).toEqual(['begin', 'write', 'commit', 'after_commit']);
  });

  it('discards manual-adapter callbacks on rollback', () => {
    const events: string[] = [];
    useManualAdapter(events);

    expect(() =>
      runMemoryTransaction(() => {
        events.push('write');
        runAfterMemoryTransactionCommit(() => events.push('after_commit'));
        throw new Error('write_failed');
      }),
    ).toThrow('write_failed');

    expect(events).toEqual(['begin', 'write', 'rollback']);
  });

  it('runs a native-adapter callback only after commit', () => {
    const events: string[] = [];
    useNativeAdapter(events);

    runMemoryTransaction(() => {
      events.push('write');
      runAfterMemoryTransactionCommit(() => events.push('after_commit'));
    });

    expect(events).toEqual(['begin', 'write', 'commit', 'after_commit']);
  });

  it('discards native-adapter callbacks on rollback', () => {
    const events: string[] = [];
    useNativeAdapter(events);

    expect(() =>
      runMemoryTransaction(() => {
        events.push('write');
        runAfterMemoryTransactionCommit(() => events.push('after_commit'));
        throw new Error('write_failed');
      }),
    ).toThrow('write_failed');

    expect(events).toEqual(['begin', 'write', 'rollback']);
  });

  it('flushes nested callbacks once and only after the outer commit', () => {
    const events: string[] = [];
    useManualAdapter(events);

    runMemoryTransaction(() => {
      events.push('outer_write');
      runAfterMemoryTransactionCommit(() => events.push('outer_after_commit'));
      runMemoryTransaction(() => {
        events.push('inner_write');
        runAfterMemoryTransactionCommit(() => events.push('inner_after_commit'));
      });
      events.push('inner_returned');
    });

    expect(events).toEqual([
      'begin',
      'outer_write',
      'inner_write',
      'inner_returned',
      'commit',
      'outer_after_commit',
      'inner_after_commit',
    ]);
  });

  it('rolls back and resets state when manual commit fails', () => {
    const events: string[] = [];
    const failingDb = useManualAdapter(events);
    failingDb.execSync.mockImplementation((statement: string) => {
      if (statement.startsWith('BEGIN')) events.push('begin');
      if (statement === 'COMMIT') {
        events.push('commit_failed');
        throw new Error('commit_failed');
      }
      if (statement === 'ROLLBACK') events.push('rollback');
    });

    expect(() =>
      runMemoryTransaction(() => {
        events.push('write');
        runAfterMemoryTransactionCommit(() => events.push('after_failed_commit'));
      }),
    ).toThrow('commit_failed');
    expect(events).toEqual(['begin', 'write', 'commit_failed', 'rollback']);

    const recoveryEvents: string[] = [];
    useManualAdapter(recoveryEvents);
    expect(runMemoryTransaction(() => 'recovered')).toBe('recovered');
    expect(recoveryEvents).toEqual(['begin', 'commit']);
  });

  it.each(['manual', 'native'] as const)(
    'rejects thenable callbacks before the %s adapter commits',
    (adapter) => {
      const events: string[] = [];
      if (adapter === 'manual') useManualAdapter(events);
      else useNativeAdapter(events);
      const unsafeDynamicCallback = (() => {
        events.push('write');
        runAfterMemoryTransactionCommit(() => events.push('after_commit'));
        return Promise.resolve('unsafe');
      }) as unknown as () => string;

      expect(() => runMemoryTransaction(unsafeDynamicCallback)).toThrow(
        'memory_transaction_async_callback_not_supported',
      );
      expect(events).toEqual(['begin', 'write', 'rollback']);
    },
  );

  it('isolates callback errors after commit and continues remaining callbacks', () => {
    const events: string[] = [];
    useManualAdapter(events);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = runMemoryTransaction(() => {
      runAfterMemoryTransactionCommit(() => {
        events.push('first_callback');
        throw new Error('listener_failed');
      });
      runAfterMemoryTransactionCommit(() => events.push('second_callback'));
      return 'durable';
    });

    expect(result).toBe('durable');
    expect(events).toEqual(['begin', 'commit', 'first_callback', 'second_callback']);
    expect(consoleError).toHaveBeenCalledWith(
      '[memory-transaction] Post-commit callback failed.',
      expect.objectContaining({ message: 'listener_failed' }),
    );
    consoleError.mockRestore();
  });
});
