const mockDatabaseCleanup = jest.fn();
const mockFileCleanup = jest.fn();

jest.mock('../../../src/services/memory/database', () => ({
  removeRetiredMemoryDatabaseArtifactsAtStartup: (...args: unknown[]) =>
    mockDatabaseCleanup(...args),
}));
jest.mock('../../../src/services/memory/retiredMemoryArtifacts', () => ({
  removeRetiredMemoryFileArtifacts: (...args: unknown[]) => mockFileCleanup(...args),
}));

import { removeRetiredMemoryArtifacts } from '../../../src/services/memory/retiredMemoryCleanup';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('retired memory cleanup', () => {
  it('attempts database and file cleanup', () => {
    removeRetiredMemoryArtifacts();

    expect(mockDatabaseCleanup).toHaveBeenCalledTimes(1);
    expect(mockFileCleanup).toHaveBeenCalledTimes(1);
  });

  it('attempts file cleanup even when database cleanup must be retried', () => {
    const failure = new Error('database busy');
    mockDatabaseCleanup.mockImplementationOnce(() => {
      throw failure;
    });

    expect(() => removeRetiredMemoryArtifacts()).toThrow(failure);
    expect(mockFileCleanup).toHaveBeenCalledTimes(1);
  });
});
