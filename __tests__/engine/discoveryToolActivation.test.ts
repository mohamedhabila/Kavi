import { collectActivatedToolNamesFromDiscoveryPayload } from '../../src/engine/graph/discoveryToolActivation';
import { collectConversationToolNames } from '../../src/engine/graph/turnToolSurface';
import type { Message } from '../../src/types/message';

function assistantCall(id: string, name: string, args = '{}'): Message {
  return {
    id: `assistant-${id}`,
    role: 'assistant',
    content: '',
    timestamp: 1,
    toolCalls: [{ id, name, arguments: args, status: 'completed' }],
  };
}

function toolResult(id: string, content: string): Message {
  return { id: `tool-${id}`, role: 'tool', content, toolCallId: id, timestamp: 2 };
}

function catalogResult(...names: string[]): string {
  return JSON.stringify({
    tools: names.map((name) => ({ name, activation: { name, eligible: true } })),
  });
}

describe('collectConversationToolNames', () => {
  it('lists every called or activated tool in the order it first appeared', () => {
    const names = collectConversationToolNames([
      { id: 'user-1', role: 'user', content: 'Plan my trip', timestamp: 0 },
      assistantCall('tc-read', 'read_file'),
      toolResult('tc-read', 'notes'),
      assistantCall('tc-catalog', 'tool_catalog', '{"query":"calendar"}'),
      toolResult('tc-catalog', catalogResult('calendar_create_event', 'calendar_list')),
      assistantCall('tc-create', 'calendar_create_event'),
      toolResult('tc-create', '{"status":"created"}'),
    ]);

    expect(names).toEqual(['read_file', 'calendar_create_event', 'calendar_list']);
  });

  it('keeps activations from every turn in the window, not only the latest search', () => {
    const names = collectConversationToolNames([
      { id: 'user-1', role: 'user', content: 'First', timestamp: 0 },
      assistantCall('tc-1', 'tool_catalog'),
      toolResult('tc-1', catalogResult('pdf_read')),
      { id: 'user-2', role: 'user', content: 'Second', timestamp: 3 },
      assistantCall('tc-2', 'tool_catalog'),
      toolResult('tc-2', catalogResult('camera_snap')),
    ]);

    expect(names).toEqual(['pdf_read', 'camera_snap']);
  });

  it('does not list the discovery tools themselves', () => {
    expect(
      collectConversationToolNames([
        assistantCall('tc-1', 'tool_describe', '{"name":"pdf_read"}'),
        toolResult('tc-1', 'not json'),
      ]),
    ).toEqual([]);
  });
});

describe('collectActivatedToolNamesFromDiscoveryPayload', () => {
  it('collects canonical registry names from structured activation metadata', () => {
    expect(
      collectActivatedToolNamesFromDiscoveryPayload({
        tools: [
          {
            name: 'memory_search',
            activation: {
              name: 'memory_search',
              eligible: true,
              callableNow: false,
            },
          },
        ],
      }),
    ).toEqual(['memory_search']);
  });

  it('ignores non-registry tool names and ineligible activation entries', () => {
    expect(
      collectActivatedToolNamesFromDiscoveryPayload({
        tools: [
          { name: 'not_a_real_tool' },
          {
            name: 'memory_search',
            activation: {
              name: 'memory_search',
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
        tools: [{ name: 'memory_search' }, { name: 'not_a_real_tool' }],
      }),
    ).toEqual(['memory_search']);
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
