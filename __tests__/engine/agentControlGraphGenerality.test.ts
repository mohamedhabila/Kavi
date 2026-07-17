import {
  createInitialAgentControlGraphSnapshot,
  getAgentControlGraphMissingToolResultIds,
  reduceAgentControlGraph,
} from '../../src/engine/graph/agentControlGraph';

describe('agent control graph generality and bounds', () => {
  it('does not encode domain-specific tool behavior in graph state', () => {
    const snapshot = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      { type: 'MODEL_TURN_STARTED', iteration: 4, toolNames: ['external_monitor'] },
      {
        type: 'MODEL_TURN_COMPLETED',
        iteration: 4,
        toolCalls: [{ id: 'monitor-1', name: 'external_monitor' }],
      },
    ]);

    expect(JSON.stringify(snapshot)).not.toMatch(/expo|github|eas/i);
  });

  it('tracks representative tool families as opaque capabilities', () => {
    const representativeToolCalls = [
      { id: 'builtin-1', name: 'write_file' },
      { id: 'mcp-1', name: 'mcp__database__query' },
      { id: 'skill-1', name: 'skill__repository__commit' },
      { id: 'subagent-1', name: 'sessions_spawn' },
      { id: 'browser-1', name: 'browser_click' },
      { id: 'device-1', name: 'android_tap' },
      { id: 'memory-1', name: 'memory_search' },
      { id: 'monitor-1', name: 'ssh_wait_for_job' },
    ];

    let snapshot = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      {
        type: 'MODEL_TURN_STARTED',
        iteration: 10,
        toolNames: representativeToolCalls.map((call) => call.name),
      },
      {
        type: 'MODEL_TURN_COMPLETED',
        iteration: 10,
        toolCalls: representativeToolCalls,
      },
    ]);

    expect(snapshot.status).toBe('awaiting_tool_results');
    expect(snapshot.expectedToolCalls).toEqual(representativeToolCalls);
    expect(getAgentControlGraphMissingToolResultIds(snapshot)).toEqual(
      representativeToolCalls.map((call) => call.id),
    );

    snapshot = reduceAgentControlGraph(snapshot, [
      {
        type: 'TOOL_RESULTS_RECORDED',
        results: representativeToolCalls.map((call) => ({ ...call })),
      },
    ]);

    expect(snapshot.status).toBe('ready');
    expect(getAgentControlGraphMissingToolResultIds(snapshot)).toEqual([]);
  });

  it('caps the audit trail so long runs remain mobile-safe', () => {
    const events = Array.from({ length: 150 }, (_, index) => ({
      type: 'ASYNC_WAITING' as const,
      pendingAsyncCount: index,
      timestamp: 2000 + index,
    }));

    const snapshot = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), events);

    expect(snapshot.audit).toHaveLength(128);
    expect(snapshot.audit[0]?.timestamp).toBe(2022);
    expect(snapshot.audit.at(-1)?.timestamp).toBe(2149);
  });
});
