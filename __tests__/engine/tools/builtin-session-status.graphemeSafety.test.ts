const mockGetSubAgent = jest.fn();
jest.mock('../../../src/services/agents/subAgent', () => ({
  getSubAgent: (...args: unknown[]) => mockGetSubAgent(...args),
}));

jest.mock('../../../src/services/agents/commandPollBackoff', () => ({
  pruneStaleCommandPolls: jest.fn(),
  recordCommandPoll: jest.fn().mockReturnValue(1000),
  resetCommandPollCount: jest.fn(),
}));

import { executeSessionStatus } from '../../../src/engine/tools/builtin-session-status';
import {
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

describe('executeSessionStatus — outputPreview grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 320-char output preview budget`, async () => {
      const output = buildBoundaryStraddlingText(320, cluster, 100);
      mockGetSubAgent.mockReturnValue({
        sessionId: 'session-1',
        status: 'completed',
        startedAt: Date.now() - 1000,
        output,
      });

      const outcome = await executeSessionStatus({ sessionId: 'session-1' });
      const parsed = JSON.parse((outcome as any).content);
      expectGraphemeSafe(String(parsed.outputPreview ?? ''));
      expect(endsOnGraphemeBoundary(output, String(parsed.outputPreview ?? ''))).toBe(true);
    });
  }
});
