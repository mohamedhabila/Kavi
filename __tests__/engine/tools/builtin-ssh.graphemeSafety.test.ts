const mockGetBackgroundJob = jest.fn();
jest.mock('../../../src/engine/tools/enhancedExec', () => ({
  enhancedExec: jest.fn(),
  getBackgroundJob: (...args: unknown[]) => mockGetBackgroundJob(...args),
}));

jest.mock('../../../src/services/ssh/connector', () => ({
  deleteSshPath: jest.fn(),
  executeSshCommand: jest.fn(),
  listSshDirectory: jest.fn(),
  makeSshDirectory: jest.fn(),
  readSshTextFile: jest.fn(),
  renameSshPath: jest.fn(),
  resolveSshTarget: jest.fn(),
  writeSshTextFile: jest.fn(),
}));

import { executeSshBackgroundJobStatus } from '../../../src/engine/tools/builtin-ssh';
import {
  buildBoundaryStraddlingText,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

describe('executeSshBackgroundJobStatus — output excerpt grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 2000-char output excerpt budget`, async () => {
      const output = buildBoundaryStraddlingText(2000, cluster, 200);
      mockGetBackgroundJob.mockReturnValue({
        status: 'completed',
        command: 'echo hi',
        targetId: 'target-1',
        startedAt: Date.now(),
        output,
      });

      const outcome = await executeSshBackgroundJobStatus({ jobId: 'job-1' });
      const parsed = JSON.parse((outcome as any).content);
      expectGraphemeSafe(String(parsed.outputExcerpt ?? ''));
    });
  }
});
