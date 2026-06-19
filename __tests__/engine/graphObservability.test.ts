import {
  createInitialAgentControlGraphSnapshot,
  reduceAgentControlGraph,
} from '../../src/engine/graph/agentControlGraph';
import {
  buildCompletionGateObservabilityDetail,
  buildGraphObservabilityRecordedEvent,
  buildLoopDetectedObservabilityDetail,
  buildMemoryRetrievalObservabilityDetail,
  buildToolSurfaceObservabilityDetail,
  buildToolSurfaceTokenAuditDetail,
  GRAPH_OBSERVABILITY_AUDIT_TYPES,
} from '../../src/engine/graph/graphObservability';
import { MAX_AGENT_RUN_CONTROL_GRAPH_AUDIT_EVENTS } from '../../src/services/agents/agentControlGraphState';

describe('graphObservability', () => {
  it('builds count-only observability details without message bodies', () => {
    expect(
      buildCompletionGateObservabilityDetail({
        type: 'hold',
        reason: 'goals_incomplete',
        graphEvent: { type: 'FINALIZATION_HELD', reason: 'goals_incomplete' },
        systemPrompts: ['[SYSTEM HOLD]'],
        missingRequiredEvidenceLabels: [],
      }),
    ).toBe('decision:hold,reason:goals_incomplete');

    expect(
      buildCompletionGateObservabilityDetail({
        type: 'auto_complete_goals',
        reason: 'goal_evidence_satisfied',
        graphEvent: {
          type: 'GOALS_UPDATED',
          goals: [],
          reason: 'completion_gate:auto_complete',
          timestamp: 1,
        },
      }),
    ).toBe('decision:auto_complete_goals,reason:goal_evidence_satisfied');

    expect(
      buildToolSurfaceObservabilityDetail({
        toolCount: 2,
        toolNames: ['read_file', 'web_search'],
        tokenEstimate: 1200,
      }),
    ).toBe('count:2,tokens:1200,tools:read_file,web_search');

    expect(
      buildMemoryRetrievalObservabilityDetail({
        factCount: 3,
        episodeCount: 1,
        sectionCount: 2,
      }),
    ).toBe('facts:3,episodes:1,sections:2');

    expect(
      buildToolSurfaceTokenAuditDetail({
        selectedCount: 3,
        estimatedTokens: 900,
        evictedToolNames: ['extra_tool', 'skill__demo__run'],
        sessionPinnedCount: 1,
        turnPinnedCount: 2,
      }),
    ).toBe(
      'count:3,tokens:900,sessionPinned:1,turnPinned:2,evicted:extra_tool,skill__demo__run',
    );

    expect(
      buildLoopDetectedObservabilityDetail({
        loopDetected: true,
        level: 'critical',
        type: 'repeated_error',
      }),
    ).toBe('level:critical,type:repeated_error');
  });

  it('records observability audit events through the graph reducer', () => {
    const snapshot = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      buildGraphObservabilityRecordedEvent({
        observabilityType: GRAPH_OBSERVABILITY_AUDIT_TYPES.TOOL_SURFACE_SELECTED,
        iteration: 2,
        detail: 'count:1,tokens:100,tools:read_file',
      }),
    ]);

    expect(snapshot.audit.at(-1)).toEqual(
      expect.objectContaining({
        type: GRAPH_OBSERVABILITY_AUDIT_TYPES.TOOL_SURFACE_SELECTED,
        iteration: 2,
        detail: 'count:1,tokens:100,tools:read_file',
      }),
    );
  });

  it('caps graph audit events at the mobile-bounded limit', () => {
    let snapshot = createInitialAgentControlGraphSnapshot();
    for (let index = 0; index < MAX_AGENT_RUN_CONTROL_GRAPH_AUDIT_EVENTS + 5; index += 1) {
      snapshot = reduceAgentControlGraph(snapshot, [
        buildGraphObservabilityRecordedEvent({
          observabilityType: GRAPH_OBSERVABILITY_AUDIT_TYPES.MEMORY_RETRIEVAL,
          iteration: index,
          detail: `facts:${index}`,
        }),
      ]);
    }

    expect(snapshot.audit).toHaveLength(MAX_AGENT_RUN_CONTROL_GRAPH_AUDIT_EVENTS);
    expect(snapshot.audit[0]?.detail).toBe(`facts:5`);
    expect(snapshot.audit.at(-1)?.detail).toBe(
      `facts:${MAX_AGENT_RUN_CONTROL_GRAPH_AUDIT_EVENTS + 4}`,
    );
  });
});
