jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { executeAgentControlGraphModelTurnStreaming } from '../../src/engine/graph/modelTurnExecutionStreaming';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import {
  _resetUpstreamToolCallHealthForTests,
  getExcludedUpstreams,
  settleToolCallOutcome,
} from '../../src/services/llm/support/upstreamToolCallHealth';

// The upstream that served a model turn is credited or faulted for the tool calls that
// turn produced, so an upstream that keeps mangling arguments is routed around.

const MODEL = 'z-ai/glm-5.3-flash';

function streamOf(events: ReadonlyArray<Record<string, unknown>>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        await Promise.resolve();
        yield event;
      }
    },
  };
}

async function turnServedBy(upstream: string, toolCallId: string): Promise<void> {
  await executeAgentControlGraphModelTurnStreaming({
    allowQueuedToolCalls: true,
    applyGraphEvents: jest.fn(),
    budgetTools: [],
    callbacks: { onStateChange: jest.fn(), onToken: jest.fn() },
    iteration: 1,
    llm: {
      streamMessage: jest.fn(() =>
        streamOf([
          {
            type: 'tool_call',
            toolCall: { id: toolCallId, name: 'update_goals', arguments: '{"action":"add"}' },
          },
          {
            type: 'usage',
            usage: { inputTokens: 900, outputTokens: 30, upstreamProvider: upstream },
          },
          { type: 'done' },
        ]),
      ),
    },
    memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
    recordPerformanceMetrics: jest.fn(),
    reportUsage: jest.fn(),
    requestMessages: [{ role: 'user', content: 'Plan it' }],
    requestModel: MODEL,
    signal: undefined,
    streamOptions: {},
  } as never);
}

beforeEach(() => {
  _resetUpstreamToolCallHealthForTests();
});

describe('tool calls attributed to the upstream that served the turn', () => {
  it('route around an upstream whose calls keep arriving malformed', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await turnServedBy('InferenceNet', 'call-1');
    settleToolCallOutcome({ id: 'call-1', status: 'failed', failureKind: 'invalid_arguments' });
    await turnServedBy('InferenceNet', 'call-2');
    settleToolCallOutcome({ id: 'call-2', status: 'failed', failureKind: 'invalid_arguments' });

    expect(getExcludedUpstreams(MODEL)).toEqual(['InferenceNet']);
    warn.mockRestore();
  });

  it('leave an upstream alone when its calls succeed', async () => {
    await turnServedBy('Parasail', 'call-1');
    settleToolCallOutcome({ id: 'call-1', status: 'failed', failureKind: 'invalid_arguments' });
    await turnServedBy('Parasail', 'call-2');
    settleToolCallOutcome({ id: 'call-2', status: 'completed' });

    expect(getExcludedUpstreams(MODEL)).toEqual([]);
  });
});
