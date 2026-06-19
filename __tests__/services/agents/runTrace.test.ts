import { buildAgentRunTrace, hasAgentRunTrace } from '../../../src/services/agents/runTrace';
import { GRAPH_OBSERVABILITY_AUDIT_TYPES } from '../../../src/engine/graph/graphObservability';

describe('runTrace', () => {
  it('groups relevant audit events into iteration timelines', () => {
    const trace = buildAgentRunTrace({
      audit: [
        {
          type: 'MODEL_TURN_STARTED',
          iteration: 1,
          timestamp: 100,
        },
        {
          type: GRAPH_OBSERVABILITY_AUDIT_TYPES.TOOL_SURFACE_SELECTED,
          iteration: 1,
          timestamp: 110,
          detail: 'count:2,tokens:100,tools:read_file,web_search',
        },
        {
          type: GRAPH_OBSERVABILITY_AUDIT_TYPES.MEMORY_RETRIEVAL,
          iteration: 1,
          timestamp: 115,
          detail: 'facts:2,episodes:1,sections:1',
        },
        {
          type: GRAPH_OBSERVABILITY_AUDIT_TYPES.COMPLETION_GATE,
          iteration: 1,
          timestamp: 120,
          detail: 'decision:ready',
        },
        {
          type: 'MODEL_TURN_STARTED',
          iteration: 2,
          timestamp: 200,
        },
      ],
    });

    expect(trace).toHaveLength(2);
    expect(trace[0]).toEqual(
      expect.objectContaining({
        iteration: 1,
        events: expect.arrayContaining([
          expect.objectContaining({ type: GRAPH_OBSERVABILITY_AUDIT_TYPES.TOOL_SURFACE_SELECTED }),
          expect.objectContaining({ type: GRAPH_OBSERVABILITY_AUDIT_TYPES.MEMORY_RETRIEVAL }),
        ]),
      }),
    );
    expect(hasAgentRunTrace({ audit: trace.flatMap((entry) => entry.events) })).toBe(true);
  });

  it('returns false when no trace-worthy audit events exist', () => {
    expect(hasAgentRunTrace({ audit: [{ type: 'CUSTOM_DEBUG', timestamp: 1 }] })).toBe(false);
    expect(buildAgentRunTrace(undefined)).toEqual([]);
  });
});