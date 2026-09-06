jest.mock('../../../src/services/agents/subAgent', () => ({
  getSubAgent: jest.fn().mockReturnValue(undefined),
  startSubAgent: jest.fn(),
}));

jest.mock('../../../src/services/agents/subAgentEvidence', () => ({
  selectRecentSubAgentEvidenceActivity: jest.fn().mockReturnValue([]),
}));

import {
  serializeRunningSessionWaitEntry,
  serializeTerminalSessionResult,
} from '../../../src/engine/tools/builtin-session-resultSupport';
import {
  buildBoundaryStraddlingText,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

describe('builtin-session-resultSupport — output preview grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`serializeTerminalSessionResult never splits ${name} at the 600-char preview budget`, () => {
      const output = buildBoundaryStraddlingText(600, cluster, 200);
      const payload = serializeTerminalSessionResult({
        sessionId: 'session-1',
        status: 'completed',
        output,
        toolsUsed: [],
        iterations: 1,
      } as any);

      expectGraphemeSafe(String((payload as any).outputPreview));
    });

    it(`serializeRunningSessionWaitEntry never splits ${name} at the 320-char preview budget`, () => {
      const output = buildBoundaryStraddlingText(320, cluster, 200);
      const payload = serializeRunningSessionWaitEntry({
        sessionId: 'session-1',
        status: 'running',
        startedAt: Date.now() - 1000,
        output,
      } as any);

      expectGraphemeSafe(String((payload as any).outputPreview));
    });
  }
});
