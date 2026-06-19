import {
  collectActivatedToolNamesFromDiscoveryPayload,
  hasUnresolvedDiscoveryToolCallInTurn,
  selectOneShotDiscoveryToolCalls,
} from '../../src/engine/graph/discoveryToolActivation';
import type { Message } from '../../src/types/message';

describe('hasUnresolvedDiscoveryToolCallInTurn', () => {
  it('returns true when a discovery tool call has no matching tool result', () => {
    const messages: Message[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 1,
        toolCalls: [
          {
            id: 'tc-catalog',
            name: 'tool_catalog',
            arguments: '{"query":"memory_recall"}',
            status: 'pending',
          },
        ],
      },
    ];

    expect(hasUnresolvedDiscoveryToolCallInTurn(messages)).toBe(true);
  });

  it('returns false after the discovery tool result settles', () => {
    const messages: Message[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 1,
        toolCalls: [
          {
            id: 'tc-catalog',
            name: 'tool_catalog',
            arguments: '{"query":"memory_recall"}',
            status: 'completed',
          },
        ],
      },
      {
        id: 'tool-1',
        role: 'tool',
        content: '{"tools":[{"name":"memory_recall"}]}',
        toolCallId: 'tc-catalog',
        timestamp: 2,
      },
    ];

    expect(hasUnresolvedDiscoveryToolCallInTurn(messages)).toBe(false);
  });
});

describe('selectOneShotDiscoveryToolCalls', () => {
  it('keeps ordinary tool batches unchanged', () => {
    const calls = [
      { id: 'tc-read', name: 'memory_recall' },
      { id: 'tc-write', name: 'memory_remember' },
    ];

    expect(selectOneShotDiscoveryToolCalls(calls)).toEqual(calls);
  });

  it('executes only the earliest discovery call in a model turn', () => {
    expect(
      selectOneShotDiscoveryToolCalls([
        { id: 'tc-read', name: 'memory_recall' },
        { id: 'tc-catalog-1', name: 'tool_catalog' },
        { id: 'tc-catalog-2', name: 'tool_catalog' },
        { id: 'tc-describe', name: 'tool_describe' },
      ]),
    ).toEqual([{ id: 'tc-catalog-1', name: 'tool_catalog' }]);
  });
});

describe('collectActivatedToolNamesFromDiscoveryPayload', () => {
  it('collects canonical registry names from structured activation metadata', () => {
    expect(
      collectActivatedToolNamesFromDiscoveryPayload({
        tools: [
          {
            name: 'memory_recall',
            activation: {
              name: 'memory_recall',
              eligible: true,
              callableNow: false,
            },
          },
        ],
      }),
    ).toEqual(['memory_recall']);
  });

  it('ignores non-registry tool names and ineligible activation entries', () => {
    expect(
      collectActivatedToolNamesFromDiscoveryPayload({
        tools: [
          { name: 'not_a_real_tool' },
          {
            name: 'memory_recall',
            activation: {
              name: 'memory_recall',
              eligible: false,
            },
          },
        ],
      }),
    ).toEqual([]);
  });

  it('keeps legacy catalog payloads structurally constrained to registry names', () => {
    expect(
      collectActivatedToolNamesFromDiscoveryPayload({
        tools: [{ name: 'memory_recall' }, { name: 'not_a_real_tool' }],
      }),
    ).toEqual(['memory_recall']);
  });

  it('keeps legacy category payloads constrained to registered category tools', () => {
    expect(
      collectActivatedToolNamesFromDiscoveryPayload({
        category: 'browser',
        tools: [
          { name: 'browser_navigate' },
          { name: 'browser_click' },
          { name: 'browser_snapshot' },
          { name: 'not_a_real_tool' },
        ],
      }),
    ).toEqual(['browser_navigate', 'browser_click', 'browser_snapshot']);
  });

  it('collects activation from catalog search results with structured activation metadata', () => {
    expect(
      collectActivatedToolNamesFromDiscoveryPayload({
        mode: 'search',
        query: 'agent coordination',
        tools: [
          {
            name: 'agents',
            activation: {
              name: 'agents',
              eligible: true,
              callableNow: false,
            },
          },
        ],
      }),
    ).toEqual(['agents']);
  });
});
