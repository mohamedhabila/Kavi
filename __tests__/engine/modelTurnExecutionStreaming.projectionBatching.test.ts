jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { executeAgentControlGraphModelTurnStreaming } from '../../src/engine/graph/modelTurnExecutionStreaming';
import { getMemoryDb } from '../../src/services/memory/database';
import { useSettingsStore } from '../../src/store/useSettingsStore';

beforeEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false });
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false });
});

describe('model turn projection publication', () => {
  it('coalesces token events into bounded projection publications', async () => {
    const onToken = jest.fn();
    const tokenCount = 100;
    const getFirstSync = jest.spyOn(getMemoryDb(), 'getFirstSync');

    try {
      const result = await executeAgentControlGraphModelTurnStreaming({
        allowQueuedToolCalls: true,
        applyGraphEvents: jest.fn(),
        budgetTools: [],
        callbacks: { onStateChange: jest.fn(), onToken },
        iteration: 1,
        llm: {
          streamMessage: () =>
            (async function* () {
              for (let index = 0; index < tokenCount; index += 1) {
                yield { type: 'token' as const, content: String(index % 10) };
              }
              yield { type: 'done' as const };
            })(),
        },
        recordPerformanceMetrics: jest.fn(),
        reportUsage: jest.fn(),
        requestMessages: [{ role: 'user', content: 'Continue' }],
        requestModel: 'gpt-5-mini',
        signal: undefined,
        streamOptions: {},
      });

      expect(result.fullContent).toHaveLength(tokenCount);
      expect(onToken.mock.calls.flatMap(([content]) => content.split('')).join('')).toBe(
        result.fullContent,
      );
      expect(onToken.mock.calls.length).toBeLessThan(10);
      expect(getFirstSync.mock.calls.length).toBeLessThan(tokenCount);
    } finally {
      getFirstSync.mockRestore();
    }
  });
});
