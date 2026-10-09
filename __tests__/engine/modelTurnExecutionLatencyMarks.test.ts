jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { executeAgentControlGraphModelTurnStreaming } from '../../src/engine/graph/modelTurnExecutionStreaming';
import { executeAgentControlGraphModelTurnViaSendMessage } from '../../src/engine/graph/modelTurnExecutionSendMessage';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { createTurnLatencyTimeline } from '../../src/engine/turnLatencyTimeline';
import type { AgentRunTurnLatencyStage } from '../../src/types/agentRun';

function createRecordingTimeline() {
  let current = 0;
  const timeline = createTurnLatencyTimeline(() => current);
  const stages: AgentRunTurnLatencyStage[] = [];
  return {
    advance: (ms: number) => {
      current += ms;
    },
    onTurnLatencyMark: jest.fn((stage: AgentRunTurnLatencyStage) => {
      stages.push(stage);
      return timeline.mark(stage);
    }),
    stages,
  };
}

/**
 * A provider stream whose `beforeEachEvent` runs after the request is in flight: an
 * async generator executes synchronously up to its first `await`, so awaiting first
 * keeps the hook from running before the caller has returned from `next()`.
 */
function streamOf(events: ReadonlyArray<Record<string, unknown>>, beforeEachEvent?: () => void) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        await Promise.resolve();
        beforeEachEvent?.();
        yield event;
      }
    },
  };
}

function baseStreamingParams(overrides: Record<string, unknown>) {
  return {
    allowQueuedToolCalls: true,
    applyGraphEvents: jest.fn(),
    budgetTools: [],
    iteration: 1,
    memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
    recordPerformanceMetrics: jest.fn(),
    reportUsage: jest.fn(),
    requestMessages: [{ role: 'user', content: 'Hello' }],
    requestModel: 'gpt-5-mini',
    signal: undefined,
    streamOptions: {},
    ...overrides,
  };
}

describe('model turn send-to-first-output latency marks', () => {
  it('marks dispatch then first token and records the breakdown with the turn metrics', async () => {
    const timeline = createRecordingTimeline();
    const params = baseStreamingParams({
      callbacks: {
        onStateChange: jest.fn(),
        onToken: jest.fn(),
        onTurnLatencyMark: timeline.onTurnLatencyMark,
      },
      llm: {
        streamMessage: jest.fn(() =>
          streamOf(
            [
              { type: 'token', content: 'Hi' },
              { type: 'token', content: ' there' },
              { type: 'done' },
            ],
            () => timeline.advance(100),
          ),
        ),
      },
    });

    await executeAgentControlGraphModelTurnStreaming(params as never);

    expect(timeline.stages).toEqual(['model_request_dispatched', 'first_model_output']);
    expect(params.recordPerformanceMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        turnLatency: { model_request_dispatched: 0, first_model_output: 100 },
      }),
      'model_turn_completed',
    );
  });

  it('treats a first streamed tool call as the first model output', async () => {
    const timeline = createRecordingTimeline();
    const params = baseStreamingParams({
      callbacks: {
        onStateChange: jest.fn(),
        onToken: jest.fn(),
        onToolCallQueued: jest.fn(),
        onTurnLatencyMark: timeline.onTurnLatencyMark,
      },
      llm: {
        streamMessage: jest.fn(() =>
          streamOf([
            {
              type: 'tool_call',
              toolCall: { id: 'tc1', name: 'web_search', arguments: '{"query":"weather"}' },
            },
            { type: 'done' },
          ]),
        ),
      },
    });

    await executeAgentControlGraphModelTurnStreaming(params as never);

    expect(timeline.stages).toEqual(['model_request_dispatched', 'first_model_output']);
    expect(params.recordPerformanceMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        turnLatency: { model_request_dispatched: 0, first_model_output: 0 },
      }),
      'model_turn_completed',
    );
  });

  it('does not overwrite the breakdown on a later model turn of the same run', async () => {
    const timeline = createRecordingTimeline();
    const callbacks = {
      onStateChange: jest.fn(),
      onToken: jest.fn(),
      onTurnLatencyMark: timeline.onTurnLatencyMark,
    };
    const streamMessage = jest.fn(() =>
      streamOf([{ type: 'token', content: 'ok' }, { type: 'done' }]),
    );
    const first = baseStreamingParams({ callbacks, llm: { streamMessage } });
    const second = baseStreamingParams({ callbacks, iteration: 2, llm: { streamMessage } });

    await executeAgentControlGraphModelTurnStreaming(first as never);
    await executeAgentControlGraphModelTurnStreaming(second as never);

    expect(first.recordPerformanceMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ turnLatency: expect.any(Object) }),
      'model_turn_completed',
    );
    expect(second.recordPerformanceMetrics).toHaveBeenCalledWith(
      expect.not.objectContaining({ turnLatency: expect.anything() }),
      'model_turn_completed',
    );
  });

  it('keeps the dispatch mark when the stream fails before any output', async () => {
    const timeline = createRecordingTimeline();
    const params = baseStreamingParams({
      callbacks: {
        onStateChange: jest.fn(),
        onToken: jest.fn(),
        onTurnLatencyMark: timeline.onTurnLatencyMark,
      },
      llm: {
        streamMessage: jest.fn(() => ({
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.reject(new Error('provider unavailable')),
            return: () => Promise.resolve({ done: true, value: undefined }),
          }),
        })),
      },
    });

    await expect(executeAgentControlGraphModelTurnStreaming(params as never)).rejects.toThrow(
      'provider unavailable',
    );

    expect(params.recordPerformanceMetrics).toHaveBeenCalledWith(
      { modelTurnCount: 1, turnLatency: { model_request_dispatched: 0 } },
      'model_turn_failed',
    );
  });

  it('runs without a latency callback, as worker and background runs do', async () => {
    const params = baseStreamingParams({
      callbacks: { onStateChange: jest.fn(), onToken: jest.fn() },
      llm: {
        streamMessage: jest.fn(() => streamOf([{ type: 'token', content: 'x' }, { type: 'done' }])),
      },
    });

    await executeAgentControlGraphModelTurnStreaming(params as never);

    expect(params.recordPerformanceMetrics).toHaveBeenCalledWith(
      expect.not.objectContaining({ turnLatency: expect.anything() }),
      'model_turn_completed',
    );
  });

  it('marks dispatch and first output around a non-streaming request', async () => {
    const timeline = createRecordingTimeline();
    const recordPerformanceMetrics = jest.fn();

    await executeAgentControlGraphModelTurnViaSendMessage({
      applyGraphEvents: jest.fn(),
      budgetTools: [],
      callbacks: {
        onStateChange: jest.fn(),
        onToken: jest.fn(),
        onTurnLatencyMark: timeline.onTurnLatencyMark,
      },
      geminiNative: true,
      iteration: 1,
      llm: {
        sendMessage: jest.fn(async () => {
          timeline.advance(250);
          return { choices: [{ message: { content: 'Done' }, finish_reason: 'stop' }] };
        }),
      },
      memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
      recordPerformanceMetrics,
      reportUsage: jest.fn(),
      requestMessages: [{ role: 'user', content: 'Continue' }],
      requestModel: 'gemini-3-flash-preview',
      signal: undefined,
      streamOptions: {},
    } as never);

    expect(timeline.stages).toEqual(['model_request_dispatched', 'first_model_output']);
    expect(recordPerformanceMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        turnLatency: { model_request_dispatched: 0, first_model_output: 250 },
      }),
      'model_turn_completed',
    );
  });
});
