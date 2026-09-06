const mockAddRemoteArtifact = jest.fn();
jest.mock('../../../src/services/remote/store', () => ({
  addRemoteArtifact: (...args: unknown[]) => mockAddRemoteArtifact(...args),
  closeRemoteSession: jest.fn(),
  openRemoteSession: jest.fn().mockReturnValue('session-1'),
  startRemoteJob: jest.fn().mockReturnValue('job-1'),
  updateRemoteJob: jest.fn(),
}));

import { executeMcpTool } from '../../../src/services/mcp/bridge';
import type { McpClient } from '../../../src/services/mcp/client';
import {
  buildBoundaryStraddlingText,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

function makeClient(resultText: string): McpClient {
  return {
    isConnected: () => true,
    callTool: jest.fn().mockResolvedValue({
      isError: false,
      content: [{ type: 'text', text: resultText }],
    }),
  } as unknown as McpClient;
}

describe('executeMcpTool — remote artifact log-snippet grapheme safety', () => {
  beforeEach(() => {
    mockAddRemoteArtifact.mockClear();
  });

  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 2000-char artifact preview budget`, async () => {
      const resultText = buildBoundaryStraddlingText(2000, cluster, 200);
      const clients = new Map([['server-1', makeClient(resultText)]]);

      await executeMcpTool(clients, 'mcp__server-1__tool_name', '{}');

      expect(mockAddRemoteArtifact).toHaveBeenCalledTimes(1);
      const artifact = mockAddRemoteArtifact.mock.calls[0][1];
      expectGraphemeSafe(String(artifact.value ?? ''));
    });
  }
});
