import {
  buildForegroundRunGraphStateSyncEffect,
  buildForegroundRunOrchestratorStateEffect,
  buildForegroundRunPendingAsyncSyncEffect,
} from '../../src/engine/graph/foregroundRunStateSync';
import type { AgentRunControlGraphState } from '../../src/types/agentRun';

function buildGraphState(): AgentRunControlGraphState {
  return {
    version: 1,
    status: 'running',
    iteration: 0,
    expectedToolCalls: [],
    observedToolResults: [],
    pendingAsyncCount: 0,
    asyncWork: {
      awaitingBackgroundWorkers: false,
      pendingOperations: [],
      updatedAt: 42,
    },
    performance: {
      lastActiveToolCount: 0,
      maxActiveToolCount: 0,
      lastActiveToolTokenEstimate: 0,
      maxActiveToolTokenEstimate: 0,
      updatedAt: 42,
    },
    turnDirectives: {
      forceFinalText: false,
      requireWorkflowTool: false,
      incompleteFinalTextRecoveryCount: 0,
    },
    audit: [],
    updatedAt: 42,
  };
}

describe('agent control graph foreground run state sync', () => {
  it('maps orchestrator state changes to graph-owned assess effects and logs', () => {
    expect(
      buildForegroundRunOrchestratorStateEffect({
        state: 'thinking',
        model: 'gemini',
      }),
    ).toEqual({
      assessSummary: 'Analyzing the task',
      logEntry: {
        kind: 'state',
        title: 'State: Thinking',
      },
    });

    expect(
      buildForegroundRunOrchestratorStateEffect({
        state: 'responding',
        model: 'gemini',
      }),
    ).toEqual({
      logEntry: {
        kind: 'state',
        title: 'State: Responding',
        detail: 'Streaming response from gemini',
      },
    });
  });

  it('builds pending async sync effects from graph-owned async monitoring decisions', () => {
    expect(
      buildForegroundRunPendingAsyncSyncEffect({
        operations: [
          {
            key: 'deploy-1',
            kind: 'expo-workflow',
            resourceId: 'deploy-1',
            displayName: 'Deploy run',
            status: 'running',
            lastUpdatedByTool: 'workflow_status',
            updatedAt: 123,
            monitorToolNames: ['workflow_status'],
          },
        ],
        timestamp: 123,
      }),
    ).toEqual({
      asyncWorkPatch: {
        pendingOperations: [
          {
            key: 'deploy-1',
            kind: 'expo-workflow',
            resourceId: 'deploy-1',
            displayName: 'Deploy run',
            status: 'running',
            lastUpdatedByTool: 'workflow_status',
            updatedAt: 123,
            monitorToolNames: ['workflow_status'],
          },
        ],
        latestSummary: 'Waiting for Deploy run to finish.',
        timestamp: 123,
      },
      workPhasePresentation: {
        detail: 'Waiting for Deploy run to finish.',
        checkpointTitle: 'Async monitoring active',
      },
    });
  });

  it('builds graph-state sync effects without workflow plan or route projections', () => {
    const graphState = buildGraphState();

    const effect = buildForegroundRunGraphStateSyncEffect({
      controlGraph: graphState,
      lastPlanSignature: 'plan-a',
      lastRouteSignature: 'route-a',
    });

    expect(effect).toEqual({
      controlGraph: graphState,
      nextPlanSignature: 'plan-a',
      nextRouteSignature: 'route-a',
    });
  });
});
