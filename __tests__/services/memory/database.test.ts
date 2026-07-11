const mockCloseSync = jest.fn();
const mockExecSync = jest.fn();
const mockDatabase = { closeSync: mockCloseSync, execSync: mockExecSync };
const mockOpenDatabaseSync = jest.fn(() => mockDatabase);

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: (...args: unknown[]) => mockOpenDatabaseSync(...args),
}));

import {
  closeMemoryDb,
  getMemoryDb,
} from '../../../src/services/memory/database';

describe('memory database lifecycle', () => {
  beforeEach(() => {
    closeMemoryDb();
    mockCloseSync.mockReset();
    mockExecSync.mockReset();
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
    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith('DROP TABLE IF EXISTS memory_chunks');
  });

  it('closes the active database and permits a clean reopen', () => {
    getMemoryDb();
    closeMemoryDb();
    expect(mockCloseSync).toHaveBeenCalledTimes(1);

    getMemoryDb();
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });

  it('retries cleanup with a fresh database after cleanup fails', () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('database busy');
    });

    expect(() => getMemoryDb()).toThrow('database busy');
    expect(mockCloseSync).toHaveBeenCalledTimes(1);

    expect(getMemoryDb()).toBe(mockDatabase);
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });
});
