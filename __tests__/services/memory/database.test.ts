const mockCloseSync = jest.fn();
const mockDatabase = { closeSync: mockCloseSync };
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
  });

  it('closes the active database and permits a clean reopen', () => {
    getMemoryDb();
    closeMemoryDb();
    expect(mockCloseSync).toHaveBeenCalledTimes(1);

    getMemoryDb();
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(2);
  });
});
