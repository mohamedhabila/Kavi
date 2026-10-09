import * as conversationUsage from '../../../src/services/usage/conversationUsage';
import { createSubAgentUsageRecorder } from '../../../src/services/agents/lifecycle/runUsage';

describe('sub-agent usage recorder', () => {
  afterEach(() => jest.restoreAllMocks());

  it('forwards the diagnostics the engine computed for a worker call', () => {
    // Rebuilt field by field, a worker call recorded no token attribution, cache
    // telemetry, image token details, or upstream.
    const recordSpy = jest
      .spyOn(conversationUsage, 'recordConversationUsageEvent')
      .mockImplementation(() => undefined);
    const record = createSubAgentUsageRecorder({
      config: { parentConversationId: 'c1', model: 'm' } as never,
      provider: { id: 'p1', model: 'm' } as never,
      sessionId: 's1',
    });
    const tokenBuckets = {
      systemPromptTokens: 1,
      toolDeclarationTokens: 2,
      memoryContextTokens: 3,
      conversationHistoryTokens: 4,
      userTurnTokens: 5,
      toolResultTokens: 6,
    };

    record(
      {
        model: 'm',
        inputTokens: 10,
        outputTokens: 2,
        tokenBuckets,
        tokenDetails: { inputImageTokens: 4 },
        upstreamProvider: 'Fireworks',
      },
      'sub-agent',
    );

    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: expect.objectContaining({
          tokenBuckets,
          tokenDetails: { inputImageTokens: 4 },
          upstreamProvider: 'Fireworks',
        }),
        source: 'sub-agent',
        sessionId: 's1',
      }),
    );
  });
});
