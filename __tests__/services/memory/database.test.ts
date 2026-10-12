const mockCloseSync = jest.fn();
const mockExecSync = jest.fn();
const mockGetFirstSync = jest.fn(() => ({ secure_delete: 1 }));
const mockDatabase = {
  closeSync: mockCloseSync,
  execSync: mockExecSync,
  getFirstSync: mockGetFirstSync,
};
const mockOpenDatabaseSync = jest.fn(() => mockDatabase);

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: (...args: unknown[]) => mockOpenDatabaseSync(...args),
}));

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';

const RETIRED_TABLE_DROPS = [
  'memory_chunks',
  'memory_product_experience_observations',
  'memory_verified_procedure_observations',
  'memory_verified_procedure_run_invalidations',
  'memory_verified_procedure_state',
  'memory_extraction_cursor',
].map((table) => `DROP TABLE IF EXISTS ${table}`);
/** Statements one successful open executes: the secure-delete pragma, then each retired-table drop. */
const OPEN_EXEC_COUNT = 1 + RETIRED_TABLE_DROPS.length;

describe('memory database lifecycle', () => {
  beforeEach(() => {
    closeMemoryDb();
    mockCloseSync.mockReset();
    mockExecSync.mockReset();
    mockGetFirstSync.mockReset();
    mockGetFirstSync.mockReturnValue({ secure_delete: 1 });
    mockOpenDatabaseSync.mockClear();
  });

  afterAll(() => {
    closeMemoryDb();
  });

  it('opens the canonical database once and reuses it', () => {
    expect(getMemoryDb()).toBe(mockDatabase);
    expect(getMemoryDb()).toBe(mockDatabase);
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(1);
    expect(mockOpenDatabaseSync).toHaveBeenCalledWith('kavi-memory.db');
    expect(mockExecSync.mock.calls.map(([statement]) => statement)).toEqual([
      'PRAGMA secure_delete = ON',
      ...RETIRED_TABLE_DROPS,
    ]);
    expect(mockGetFirstSync).toHaveBeenCalledWith('PRAGMA secure_delete');
  });

  it('closes the active database and permits a clean reopen', () => {
    getMemoryDb();
    closeMemoryDb();
    expect(mockCloseSync).toHaveBeenCalledTimes(1);

    getMemoryDb();
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync).toHaveBeenCalledTimes(2 * OPEN_EXEC_COUNT);
  });

  it('retries cleanup with a fresh database after cleanup fails', () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('database busy');
    });

    expect(() => getMemoryDb()).toThrow('database busy');
    expect(mockCloseSync).toHaveBeenCalledTimes(1);

    expect(getMemoryDb()).toBe(mockDatabase);
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(2);
    // The first open fails on its first statement; the retry runs every statement.
    expect(mockExecSync).toHaveBeenCalledTimes(1 + OPEN_EXEC_COUNT);
  });

  it('fails closed and closes the handle when secure deletion is unavailable', () => {
    mockGetFirstSync.mockReturnValueOnce({ secure_delete: 0 });

    expect(() => getMemoryDb()).toThrow('memory_database_secure_delete_unavailable');
    expect(mockCloseSync).toHaveBeenCalledTimes(1);

    expect(getMemoryDb()).toBe(mockDatabase);
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(2);
  });
});
