const mockListActiveSubAgents = jest.fn();
const mockGetSubAgent = jest.fn();
const mockGetSessionContext = jest.fn().mockReturnValue(undefined);

jest.mock('../../../src/services/agents/subAgent', () => ({
  listActiveSubAgents: (...args: unknown[]) => mockListActiveSubAgents(...args),
  getSubAgent: (...args: unknown[]) => mockGetSubAgent(...args),
  getSessionContext: (...args: unknown[]) => mockGetSessionContext(...args),
}));

jest.mock('../../../src/services/agents/surfacedSubAgentOutput', () => ({
  createSurfacedSubAgentOutputPayload: jest.fn(),
}));

jest.mock('../../../src/services/agents/subAgentEvidence', () => ({
  selectRecentSubAgentEvidenceActivity: jest.fn().mockReturnValue([]),
}));

import {
  executeSessionHistory,
  executeSessionList,
} from '../../../src/engine/tools/builtin-session-history';
import {
  buildBoundaryStraddlingText,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

beforeEach(() => {
  mockGetSessionContext.mockReturnValue(undefined);
});

describe('executeSessionList — output preview grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 500-char output preview budget`, async () => {
      const output = buildBoundaryStraddlingText(500, cluster, 100);
      mockListActiveSubAgents.mockReturnValue([
        { sessionId: 'session-1', name: 'worker', status: 'completed', startedAt: Date.now(), output },
      ]);

      const outcome = await executeSessionList();
      const parsed = JSON.parse((outcome as any).content);
      expectGraphemeSafe(String(parsed.sessions[0].output ?? ''));
    });
  }
});

describe('executeSessionHistory — bounded-output preview grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 4000-char per-message output budget`, async () => {
      const output = buildBoundaryStraddlingText(4000, cluster, 100);
      mockGetSubAgent.mockReturnValue({
        sessionId: 'session-1',
        status: 'completed',
        startedAt: Date.now(),
        output,
        activityLog: [],
      });

      const outcome = await executeSessionHistory({ sessionId: 'session-1' });
      const parsed = JSON.parse((outcome as any).content);
      const lastMessage = parsed.messages[parsed.messages.length - 1];
      expectGraphemeSafe(String(lastMessage?.content ?? ''));
    });
  }
});

describe('executeSessionHistory — byte-budget fallback grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 317-char conversationSummary fallback budget`, async () => {
      // A conversationSummary alone this large pushes the whole serialized payload
      // past the 80KB size guard, forcing serializeSessionHistory's own further
      // truncation of the summary — the payload's message stays tiny so only this
      // one fallback branch fires.
      const conversationSummary = buildBoundaryStraddlingText(317, cluster, 90_000);
      mockGetSessionContext.mockReturnValue({ conversationSummary, messages: [] });
      mockGetSubAgent.mockReturnValue({
        sessionId: 'session-1',
        status: 'completed',
        startedAt: Date.now(),
        output: '',
        activityLog: [],
      });

      const outcome = await executeSessionHistory({ sessionId: 'session-1' });
      const parsed = JSON.parse((outcome as any).content);
      expectGraphemeSafe(String(parsed.conversationSummary ?? ''));
    });

    it(`never splits ${name} straddling the 1021-char last-message fallback budget`, async () => {
      // No conversationSummary and no agent output, so the size guard's only lever
      // left is collapsing to (and truncating) the single oversized transcript
      // message.
      const messageContent = buildBoundaryStraddlingText(1021, cluster, 90_000);
      mockGetSessionContext.mockReturnValue({
        conversationSummary: undefined,
        messages: [{ id: 'm1', role: 'assistant', content: messageContent, timestamp: 1 }],
      });
      mockGetSubAgent.mockReturnValue({
        sessionId: 'session-1',
        status: 'completed',
        startedAt: Date.now(),
        output: '',
        activityLog: [],
      });

      const outcome = await executeSessionHistory({ sessionId: 'session-1' });
      const parsed = JSON.parse((outcome as any).content);
      const lastMessage = parsed.messages[parsed.messages.length - 1];
      expectGraphemeSafe(String(lastMessage?.content ?? ''));
    });
  }
});
