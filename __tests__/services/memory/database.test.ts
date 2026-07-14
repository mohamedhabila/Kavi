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
    expect(mockExecSync).toHaveBeenNthCalledWith(1, 'PRAGMA secure_delete = ON');
    expect(mockExecSync).toHaveBeenNthCalledWith(2, 'DROP TABLE IF EXISTS memory_chunks');
    expect(mockExecSync).toHaveBeenNthCalledWith(
      3,
      'DROP TABLE IF EXISTS memory_product_experience_observations;',
    );
    expect(mockGetFirstSync).toHaveBeenCalledWith('PRAGMA secure_delete');
  });

  it('closes the active database and permits a clean reopen', () => {
    getMemoryDb();
    closeMemoryDb();
    expect(mockCloseSync).toHaveBeenCalledTimes(1);

    getMemoryDb();
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync).toHaveBeenCalledTimes(6);
  });

  it('retries cleanup with a fresh database after cleanup fails', () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('database busy');
    });

    expect(() => getMemoryDb()).toThrow('database busy');
    expect(mockCloseSync).toHaveBeenCalledTimes(1);

    expect(getMemoryDb()).toBe(mockDatabase);
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync).toHaveBeenCalledTimes(4);
  });

  it('fails closed and closes the handle when secure deletion is unavailable', () => {
    mockGetFirstSync.mockReturnValueOnce({ secure_delete: 0 });

    expect(() => getMemoryDb()).toThrow('memory_database_secure_delete_unavailable');
    expect(mockCloseSync).toHaveBeenCalledTimes(1);

    expect(getMemoryDb()).toBe(mockDatabase);
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(2);
  });
});
