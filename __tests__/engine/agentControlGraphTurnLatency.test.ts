import {
  createInitialAgentControlGraphSnapshot,
  reduceAgentControlGraph,
} from '../../src/engine/graph/agentControlGraph';

describe('agent control graph turn latency breakdown', () => {
  it('keeps the first turn latency breakdown until a later send records its own', () => {
    let snapshot = createInitialAgentControlGraphSnapshot({ updatedAt: 1000 });

    snapshot = reduceAgentControlGraph(snapshot, [
      {
        type: 'PERFORMANCE_METRICS_RECORDED',
        timestamp: 1001,
        reason: 'model_turn_completed',
        metrics: {
          modelTurnCount: 1,
          turnLatency: {
            user_message_added: 5,
            model_request_dispatched: 420,
            first_model_output: 900,
          },
        },
      },
      {
        type: 'PERFORMANCE_METRICS_RECORDED',
        timestamp: 1002,
        reason: 'model_turn_completed',
        metrics: { modelTurnCount: 1, modelDurationMs: 80 },
      },
    ]);

    expect(snapshot.performance.turnLatency).toEqual({
      user_message_added: 5,
      model_request_dispatched: 420,
      first_model_output: 900,
    });

    snapshot = reduceAgentControlGraph(snapshot, [
      {
        type: 'PERFORMANCE_METRICS_RECORDED',
        timestamp: 1003,
        reason: 'model_turn_completed',
        metrics: { modelTurnCount: 1, turnLatency: { model_request_dispatched: 150 } },
      },
    ]);

    expect(snapshot.performance.turnLatency).toEqual({ model_request_dispatched: 150 });
    expect(snapshot.performance.modelTurnCount).toBe(3);
  });

  it('keeps only known stages with finite, non-negative offsets', () => {
    const snapshot = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      {
        type: 'PERFORMANCE_METRICS_RECORDED',
        timestamp: 1001,
        reason: 'model_turn_completed',
        metrics: {
          modelTurnCount: 1,
          turnLatency: {
            provider_ready: 12.7,
            journal_active: -3,
            first_model_output: Number.NaN,
            not_a_stage: 40,
          } as never,
        },
      },
    ]);

    expect(snapshot.performance.turnLatency).toEqual({ provider_ready: 12 });
  });

  it('records no breakdown when every offset is invalid, rather than keeping a stale one', () => {
    const snapshot = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      {
        type: 'PERFORMANCE_METRICS_RECORDED',
        timestamp: 1001,
        reason: 'model_turn_completed',
        metrics: { modelTurnCount: 1, turnLatency: { provider_ready: 30 } },
      },
      {
        type: 'PERFORMANCE_METRICS_RECORDED',
        timestamp: 1002,
        reason: 'model_turn_completed',
        metrics: { modelTurnCount: 1, turnLatency: { journal_active: -1 } },
      },
    ]);

    expect(snapshot.performance.turnLatency).toBeUndefined();
  });
});
