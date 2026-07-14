jest.mock('../../src/services/agents/subAgent', () => ({
  getSubAgent: jest.fn().mockReturnValue(undefined),
  startSubAgent: jest.fn(),
}));

import { collectAgentControlGraphDelegatedCompletedToolNames } from '../../src/engine/graph/delegatedToolEvidence';
import { serializeTerminalSessionResult } from '../../src/engine/tools/builtin-session-resultSupport';

describe('delegation completion evidence', () => {
  it('counts worker tools only from verified semantic completion', () => {
    expect(
      collectAgentControlGraphDelegatedCompletedToolNames({
        hostToolName: 'sessions_wait',
        result: JSON.stringify({
          status: 'completed',
          completionState: 'incomplete',
          toolsUsed: ['write_file'],
        }),
      }),
    ).toEqual([]);

    expect(
      collectAgentControlGraphDelegatedCompletedToolNames({
        hostToolName: 'sessions_wait',
        result: JSON.stringify({
          status: 'completed',
          completionState: 'verified_success',
          toolsUsed: ['write_file', 'write_file'],
        }),
      }),
    ).toEqual(['write_file']);
  });

  it('serializes semantic completion state for downstream graph validation', () => {
    expect(
      serializeTerminalSessionResult({
        sessionId: 'worker-1',
        status: 'completed',
        terminationCause: 'completed',
        completionState: 'verified_success',
        output: 'Verified result',
        toolsUsed: ['read_file'],
        iterations: 1,
        depth: 1,
      }),
    ).toEqual(
      expect.objectContaining({
        status: 'completed',
        terminationCause: 'completed',
        completionState: 'verified_success',
      }),
    );
  });
});
