import type { AgentRunAsyncOperation, AgentRunControlGraphState } from '../../types/agentRun';
import {
  buildAgentControlGraphOpenWorkCloseoutDecision,
  buildAgentControlGraphOpenWorkPhasePresentation,
} from './asyncOpenWork';

export type ForegroundRunOrchestratorStateEffect = {
  assessSummary?: string;
  logEntry: {
    kind: 'state';
    title: string;
    detail?: string;
  };
};

export type ForegroundRunPendingAsyncSyncEffect = {
  asyncWorkPatch: {
    pendingOperations: AgentRunAsyncOperation[];
    latestSummary?: string;
    timestamp: number;
  };
  workPhasePresentation?: {
    detail: string;
    checkpointTitle: string;
  };
};

export type ForegroundRunGraphStateSyncEffect = {
  controlGraph: AgentRunControlGraphState;
  nextPlanSignature: string;
  nextRouteSignature: string;
};

function formatOrchestratorStateLabel(state: string): string {
  switch (state) {
    case 'thinking':
      return 'Thinking';
    case 'responding':
      return 'Responding';
    case 'idle':
      return 'Idle';
    case 'error':
      return 'Error';
    default:
      return state.charAt(0).toUpperCase() + state.slice(1);
  }
}

export function buildForegroundRunOrchestratorStateEffect(params: {
  state: string;
  model: string;
}): ForegroundRunOrchestratorStateEffect {
  return {
    ...(params.state === 'thinking' ? { assessSummary: 'Analyzing the task' } : {}),
    logEntry: {
      kind: 'state',
      title: `State: ${formatOrchestratorStateLabel(params.state)}`,
      ...(params.state === 'responding'
        ? { detail: `Streaming response from ${params.model}` }
        : {}),
    },
  };
}

export function buildForegroundRunPendingAsyncSyncEffect(params: {
  operations: AgentRunAsyncOperation[];
  timestamp: number;
}): ForegroundRunPendingAsyncSyncEffect {
  const openWorkCloseout = buildAgentControlGraphOpenWorkCloseoutDecision({
    backgroundWorkers: {},
    pendingOperations: params.operations,
  });
  const openWorkPresentation = buildAgentControlGraphOpenWorkPhasePresentation(openWorkCloseout);

  return {
    asyncWorkPatch: {
      pendingOperations: params.operations,
      latestSummary: openWorkPresentation?.latestSummary,
      timestamp: params.timestamp,
    },
    ...(openWorkPresentation
      ? {
          workPhasePresentation: {
            detail: openWorkPresentation.detail,
            checkpointTitle: openWorkPresentation.checkpointTitle,
          },
        }
      : {}),
  };
}

export function buildForegroundRunGraphStateSyncEffect(params: {
  controlGraph: AgentRunControlGraphState;
  lastPlanSignature: string;
  lastRouteSignature: string;
}): ForegroundRunGraphStateSyncEffect {
  return {
    controlGraph: params.controlGraph,
    nextPlanSignature: params.lastPlanSignature,
    nextRouteSignature: params.lastRouteSignature,
  };
}
