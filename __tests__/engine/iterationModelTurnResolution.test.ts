jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { resolvePreparedAgentControlGraphModelTurnResult } from '../../src/engine/graph/iterationModelTurnResolution';
import { useSettingsStore } from '../../src/store/useSettingsStore';

beforeEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false });
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false });
});

describe('resolvePreparedAgentControlGraphModelTurnResult', () => {
  // A call dropped from a batch stayed in Claude's replayed blocks with no result, so the
  // next request carried an unanswered tool_use (live: "messages.5: The final block in an
  // assistant message cannot be `thinking`", 2 of 3 Sonnet trip-organizer runs).
  it.each([
    [
      'a discovery call',
      [
        { id: 'tc-describe', name: 'tool_describe', arguments: '{"name":"calendar_create_event"}' },
        { id: 'tc-create', name: 'calendar_create_event', arguments: '{"title":"Flight"}' },
      ],
    ],
    [
      'a sessions_yield',
      [
        { id: 'tc-yield', name: 'sessions_yield', arguments: '{}' },
        { id: 'tc-read', name: 'read_file', arguments: '{"path":"a.txt"}' },
      ],
    ],
    [
      'a clarification',
      [
        { id: 'tc-read', name: 'read_file', arguments: '{"path":"a.txt"}' },
        { id: 'tc-ask', name: 'request_clarification', arguments: '{"question":"Which?"}' },
      ],
    ],
  ])('hands every call to tool execution when a batch holds %s', async (_label, calls) => {
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
      pendingToolCalls: calls,
      contextWindow: 100_000,
      requestMaxTokens: 2048,
      executePendingToolTurn,
    });

    expect(status).toBe('continued');
    expect(applyAgentControlGraphEvents).not.toHaveBeenCalled();
    expect(executePendingToolTurn).toHaveBeenCalledWith(
      expect.objectContaining({ pendingToolCalls: calls }),
    );
  });
});
jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});
