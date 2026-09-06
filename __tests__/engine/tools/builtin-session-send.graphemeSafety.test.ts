const mockGetSubAgent = jest.fn();
const mockGetSessionContext = jest.fn().mockReturnValue(undefined);
const mockLaunchSubAgent = jest.fn();

jest.mock('../../../src/services/agents/subAgent', () => ({
  getSubAgent: (...args: unknown[]) => mockGetSubAgent(...args),
  getSessionContext: (...args: unknown[]) => mockGetSessionContext(...args),
  launchSubAgent: (...args: unknown[]) => mockLaunchSubAgent(...args),
  listActiveSubAgents: jest.fn().mockReturnValue([]),
  observeBackgroundSubAgentResult: jest.fn(),
  startSubAgent: jest.fn(),
}));

jest.mock('../../../src/services/conversationWorkspace/ownership', () => ({
  resolveConfiguredConversationWorkspaceTarget: jest.fn().mockReturnValue(undefined),
  resolveConversationWorkspaceTarget: jest.fn().mockReturnValue(undefined),
}));

jest.mock('../../../src/services/agents/lifecycle/stateMachine', () => ({
  resolveOwningConversationId: jest.fn().mockReturnValue(undefined),
}));

jest.mock('../../../src/store/useChatStore', () => ({
  useChatStore: { getState: () => ({ conversations: [] }) },
}));

jest.mock('../../../src/store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({}) },
}));

jest.mock('../../../src/services/llm/support/providerSupport', () => ({
  assertProviderReadyForRequest: jest.fn(),
  hydrateProviderForRequest: jest.fn(async (provider: unknown) => provider),
}));

jest.mock('../../../src/services/agents/workerMemoryBundle', () => ({
  buildLeastPrivilegeWorkerMemoryBundle: jest.fn(),
  sanitizeSubAgentMemorySelectionScope: jest.fn().mockReturnValue(undefined),
}));

import { executeSessionSend } from '../../../src/engine/tools/builtin-session-send';
import {
  buildBoundaryStraddlingText,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

describe('executeSessionSend — previousOutput grapheme safety', () => {
  beforeEach(() => {
    mockLaunchSubAgent.mockReset();
    mockLaunchSubAgent.mockResolvedValue({ status: 'running', sessionId: 'session-2', depth: 1 });
  });

  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 4000-char previous-output budget`, async () => {
      const output = buildBoundaryStraddlingText(4000, cluster, 100);
      mockGetSubAgent.mockReturnValue({
        sessionId: 'session-1',
        status: 'completed',
        output,
      });

      await executeSessionSend(
        { sessionId: 'session-1', message: 'continue' },
        { id: 'provider-1', name: 'Provider' } as any,
      );

      expect(mockLaunchSubAgent).toHaveBeenCalledTimes(1);
      const followUpConfig = mockLaunchSubAgent.mock.calls[0][0];
      expectGraphemeSafe(String(followUpConfig.prompt ?? followUpConfig.workerPrompt ?? ''));
    });
  }
});
