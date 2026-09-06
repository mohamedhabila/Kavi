const mockGetSubAgent = jest.fn();
jest.mock('../../../src/services/agents/subAgent', () => ({
  cancelSubAgent: jest.fn(),
  getSubAgent: (...args: unknown[]) => mockGetSubAgent(...args),
  getSubAgentsByParent: jest.fn().mockReturnValue([]),
}));

import { executeSessionCancel } from '../../../src/engine/tools/builtin-session-control';
import {
  buildBoundaryStraddlingText,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

describe('executeSessionCancel — outputPreview grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 1000-char output preview budget`, async () => {
      const output = buildBoundaryStraddlingText(1000, cluster, 100);
      mockGetSubAgent.mockReturnValue({
        sessionId: 'session-1',
        status: 'completed',
        output,
      });

      const outcome = await executeSessionCancel({ sessionId: 'session-1' });
      const parsed = JSON.parse((outcome as any).content);
      expectGraphemeSafe(String(parsed.outputPreview ?? ''));
    });
  }
});
