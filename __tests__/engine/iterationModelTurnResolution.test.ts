import { resolvePreparedAgentControlGraphModelTurnResult } from '../../src/engine/graph/iterationModelTurnResolution';

describe('resolvePreparedAgentControlGraphModelTurnResult', () => {
  it('hands only the earliest discovery call to tool execution', async () => {
    const applyAgentControlGraphEvents = jest.fn();
    const executePendingToolTurn = jest.fn().mockResolvedValue('continued');
    const status = await resolvePreparedAgentControlGraphModelTurnResult({
      iterationParams: {
        iteration: 3,
        graph: {
          getCurrentTurnDirectives: () => ({}),
          applyAgentControlGraphEvents,
        },
      } as any,
      modelTurnPreparation: {} as any,
      runtime: {
        workingMessages: [],
        consecutivePendingAsyncNoToolTurns: 0,
      } as any,
      fullContent: '',
      reasoning: '',
      pendingToolCalls: [
        { id: 'tc-memory', name: 'memory_recall', arguments: '{}' },
        { id: 'tc-catalog-1', name: 'tool_catalog', arguments: '{"query":"memory_recall"}' },
        { id: 'tc-catalog-2', name: 'tool_catalog', arguments: '{"query":"memory_remember"}' },
      ],
      contextWindow: 100_000,
      requestMaxTokens: 2048,
      executePendingToolTurn,
    });

    expect(status).toBe('continued');
    expect(applyAgentControlGraphEvents).toHaveBeenCalledWith([
      {
        type: 'MODEL_TURN_COMPLETED',
        iteration: 3,
        toolCalls: [{ id: 'tc-catalog-1', name: 'tool_catalog' }],
      },
    ]);
    expect(executePendingToolTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingToolCalls: [
          { id: 'tc-catalog-1', name: 'tool_catalog', arguments: '{"query":"memory_recall"}' },
        ],
      }),
    );
  });
});
