const mockUpdateJob = jest.fn();
const mockExecuteSshCommand = jest.fn();

jest.mock('../../src/services/remote/store', () => ({
  useRemoteStore: {
    getState: () => ({
      createJob: jest.fn(),
      updateJob: mockUpdateJob,
    }),
  },
}));

jest.mock('../../src/services/remote/approvalStore', () => ({
  needsApprovalWithContext: jest.fn().mockReturnValue(false),
  requestToolApproval: jest.fn(),
}));

jest.mock('../../src/services/ssh/connector', () => ({
  resolveSshTarget: jest.fn().mockResolvedValue({ id: 'target-1', remoteRoot: '/remote/root' }),
  executeSshCommand: (...args: unknown[]) => mockExecuteSshCommand(...args),
}));

import { enhancedExec } from '../../src/engine/tools/enhancedExec';
import {
  buildBoundaryStraddlingText,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../helpers/graphemeTestFixtures';

describe('enhancedExec (background) — progressText grapheme safety', () => {
  beforeEach(() => {
    mockUpdateJob.mockClear();
  });

  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 200-char progressText budget`, async () => {
      const output = buildBoundaryStraddlingText(200, cluster, 100);
      mockExecuteSshCommand.mockResolvedValue(output);

      await enhancedExec('run-something', { background: true });
      // Let the fire-and-forget background execution settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockUpdateJob).toHaveBeenCalled();
      const completedCall = mockUpdateJob.mock.calls.find(
        (call) => call[1]?.status === 'completed',
      );
      expect(completedCall).toBeDefined();
      expectGraphemeSafe(String(completedCall![1].progressText ?? ''));
    });
  }
});
