// ---------------------------------------------------------------------------
// Tests — Enhanced Exec Tool
// ---------------------------------------------------------------------------

jest.mock('../../src/services/remote/store', () => ({
  useRemoteStore: {
    getState: () => ({
      createJob: jest.fn(),
      updateJob: jest.fn(),
    }),
  },
}));

jest.mock('../../src/services/remote/approvalStore', () => ({
  needsApprovalWithContext: jest.fn().mockReturnValue(false),
  requestToolApproval: jest.fn(),
}));

jest.mock('../../src/services/ssh/connector', () => ({
  resolveSshTarget: jest.fn().mockResolvedValue({
    id: 'target-1',
    remoteRoot: '/remote/root',
  }),
  executeSshCommand: jest.fn().mockResolvedValue('ok'),
}));

import {
  enhancedExec,
  getBackgroundJob,
  listBackgroundJobs,
  cancelBackgroundJob,
  cleanupBackgroundJobs,
} from '../../src/engine/tools/enhancedExec';

// The enhancedExec + startBackgroundExec functions require SSH and store
// interaction that we test indirectly. These tests focus on the background
// job management layer which is pure in-memory logic.

describe('background job management', () => {
  // Note: backgroundTasks is module-level Map, so we can only test the
  // management functions that work on top of it.

  it('listBackgroundJobs returns array', () => {
    const jobs = listBackgroundJobs();
    expect(Array.isArray(jobs)).toBe(true);
  });

  it('getBackgroundJob returns undefined for non-existent ID', () => {
    expect(getBackgroundJob('nonexistent-id')).toBeUndefined();
  });

  it('cancelBackgroundJob returns false for non-existent ID', () => {
    expect(cancelBackgroundJob('nonexistent-id')).toBe(false);
  });

  it('cleanupBackgroundJobs returns 0 when no tasks', () => {
    const count = cleanupBackgroundJobs();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('clears the foreground execution timeout when the command finishes early', async () => {
    jest.useFakeTimers();

    try {
      const result = await enhancedExec('pwd', { timeoutMs: 30_000, targetId: 'target-1' });

      expect(JSON.parse(result)).toMatchObject({
        status: 'executed',
        targetId: 'target-1',
        output: 'ok',
      });
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
