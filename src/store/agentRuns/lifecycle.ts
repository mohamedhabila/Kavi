import type {
  AgentRun,
  AgentRunCheckpointKind,
  AgentRunPhaseKey,
  AgentRunPhaseStatus,
  AgentRunStatus,
  AgentRunSummary,
  AgentRunTerminalReason,
} from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import { generateId } from '../../utils/id';
import {
  areAgentRunPhasesEqual,
  areAgentRunSummariesEqual,
  createDefaultAgentRunPlan,
  createInitialAgentRunPhases,
  getAgentRunPhaseIndex,
  mergeAgentRunSummary,
  skipRemainingAgentRunPhases,
  transitionAgentRunPhases,
} from '../../services/agents/agentRunStateModel';
import {
  createInitialAgentRunControlGraphState,
  updateAgentRunControlGraphAsyncWorkState,
} from '../../services/agents/agentControlGraphState';
import { appendAgentCheckpoint, isTargetAgentRun, resolveTargetAgentRunId } from './shared';
import { settleActiveToolCallsInAgentRunMessages } from './toolCalls';

const MAX_AGENT_RUNS = 24;
const SUPERSEDED_RUN_TOOL_CALL_ERROR =
  'Tool call was interrupted because the run was superseded by a newer user turn.';

function buildTerminalRunToolCallError(status: Exclude<AgentRunStatus, 'running'>): string {
  if (status === 'cancelled') {
    return 'Tool call was interrupted because the run was cancelled before completion.';
  }

  if (status === 'failed') {
    return 'Tool call was interrupted because the run failed before completion.';
  }

  return 'Tool call did not complete before the run reached a terminal state.';
}

type StartAgentRunParams = {
  goal: string;
  runId: string;
  summary?: Partial<AgentRunSummary>;
  timestamp: number;
  userMessageId: string;
};

export function startAgentRunInConversation(
  conversation: Conversation,
  params: StartAgentRunParams,
): Conversation {
  let nextMessages = conversation.messages;
  const nextRuns = (conversation.agentRuns ?? []).map((run) => {
    if (run.id !== conversation.activeAgentRunId || run.status !== 'running') {
      return run;
    }

    const settledToolCalls = settleActiveToolCallsInAgentRunMessages({
      messages: nextMessages,
      run,
      timestamp: params.timestamp,
      errorMessage: SUPERSEDED_RUN_TOOL_CALL_ERROR,
    });
    if (settledToolCalls.settledCount > 0) {
      nextMessages = settledToolCalls.messages;
    }

    const supersededControlGraph = updateAgentRunControlGraphAsyncWorkState(run.controlGraph, {
      awaitingBackgroundWorkers: false,
      pendingOperations: [],
      updatedAt: params.timestamp,
    });
    return appendAgentCheckpoint(
      {
        ...run,
        status: 'cancelled',
        controlGraph: supersededControlGraph,
        completedAt: params.timestamp,
        updatedAt: params.timestamp,
        phases: skipRemainingAgentRunPhases(
          transitionAgentRunPhases(
            run.phases,
            run.currentPhase,
            'skipped',
            params.timestamp,
            'Superseded by a new user turn.',
          ),
          run.currentPhase,
          params.timestamp,
        ),
      },
      {
        timestamp: params.timestamp,
        kind: 'run',
        title: 'Run superseded',
        detail: 'A new user turn started before the previous run finished.',
      },
    );
  });

  const newRun: AgentRun = {
    id: params.runId,
    userMessageId: params.userMessageId,
    goal: params.goal,
    status: 'running',
    controlGraph: createInitialAgentRunControlGraphState({ updatedAt: params.timestamp }),
    createdAt: params.timestamp,
    updatedAt: params.timestamp,
    currentPhase: 'assess',
    phases: createInitialAgentRunPhases(params.timestamp),
    checkpoints: [
      {
        id: generateId(),
        timestamp: params.timestamp,
        kind: 'run',
        title: 'Turn started',
        detail: params.goal,
      },
    ],
    plan: createDefaultAgentRunPlan(params.goal, params.timestamp),
    evidence: [],
    summary: mergeAgentRunSummary(undefined, params.summary),
  };

  return {
    ...conversation,
    updatedAt: Math.max(conversation.updatedAt, params.timestamp),
    messages: nextMessages,
    agentRuns: [...nextRuns, newRun].slice(-MAX_AGENT_RUNS),
    activeAgentRunId: params.runId,
  };
}

export function setAgentRunPhaseInConversation(
  conversation: Conversation,
  phase: AgentRunPhaseKey,
  params?: {
    allowRegression?: boolean;
    checkpointDetail?: string;
    checkpointKind?: AgentRunCheckpointKind;
    checkpointTitle?: string;
    detail?: string;
    status?: Exclude<AgentRunPhaseStatus, 'pending'>;
    timestamp?: number;
  },
  runId?: string,
): Conversation {
  const targetRunId = resolveTargetAgentRunId(conversation, runId);
  if (!targetRunId) {
    return conversation;
  }

  const timestamp = params?.timestamp ?? Date.now();
  let didUpdate = false;
  const nextRuns = (conversation.agentRuns ?? []).map((run) => {
    if (!isTargetAgentRun(run, targetRunId)) {
      return run;
    }

    const nextPhaseIndex = getAgentRunPhaseIndex(phase);
    const currentPhaseIndex = getAgentRunPhaseIndex(run.currentPhase);
    const shouldPreserveCurrentPhase =
      !params?.allowRegression &&
      nextPhaseIndex >= 0 &&
      currentPhaseIndex >= 0 &&
      nextPhaseIndex < currentPhaseIndex;
    const nextPhases = shouldPreserveCurrentPhase
      ? run.phases
      : transitionAgentRunPhases(
          run.phases,
          phase,
          params?.status ?? 'active',
          timestamp,
          params?.detail,
          { allowRegression: params?.allowRegression },
        );
    const nextCurrentPhase = shouldPreserveCurrentPhase ? run.currentPhase : phase;
    if (
      !params?.checkpointTitle &&
      run.currentPhase === nextCurrentPhase &&
      areAgentRunPhasesEqual(run.phases, nextPhases)
    ) {
      return run;
    }

    didUpdate = true;
    const nextRunBase: AgentRun = {
      ...run,
      currentPhase: nextCurrentPhase,
      updatedAt: Math.max(run.updatedAt, timestamp),
      phases: nextPhases,
    };

    return params?.checkpointTitle
      ? appendAgentCheckpoint(nextRunBase, {
          timestamp,
          kind: params.checkpointKind ?? 'phase',
          title: params.checkpointTitle,
          detail: params.checkpointDetail ?? params.detail,
        })
      : nextRunBase;
  });

  return didUpdate
    ? {
        ...conversation,
        updatedAt: Math.max(conversation.updatedAt, timestamp),
        agentRuns: nextRuns,
      }
    : conversation;
}

export function appendAgentRunCheckpointInConversation(
  conversation: Conversation,
  entry: {
    detail?: string;
    kind?: AgentRunCheckpointKind;
    timestamp?: number;
    title: string;
  },
  runId?: string,
): Conversation {
  const targetRunId = resolveTargetAgentRunId(conversation, runId);
  if (!targetRunId) {
    return conversation;
  }

  const timestamp = entry.timestamp ?? Date.now();
  let didUpdate = false;
  const nextRuns = (conversation.agentRuns ?? []).map((run) => {
    if (!isTargetAgentRun(run, targetRunId, !!runId)) {
      return run;
    }

    didUpdate = true;
    return appendAgentCheckpoint(run, {
      timestamp,
      kind: entry.kind ?? 'note',
      title: entry.title,
      detail: entry.detail,
    });
  });

  return didUpdate
    ? {
        ...conversation,
        updatedAt: Math.max(conversation.updatedAt, timestamp),
        agentRuns: nextRuns,
      }
    : conversation;
}

export function updateAgentRunSummaryInConversation(
  conversation: Conversation,
  patch: Partial<AgentRunSummary> & { latestSummary?: string; timestamp?: number },
  runId?: string,
): Conversation {
  const targetRunId = resolveTargetAgentRunId(conversation, runId);
  if (!targetRunId) {
    return conversation;
  }

  const timestamp = patch.timestamp ?? Date.now();
  let didUpdate = false;
  const nextRuns = (conversation.agentRuns ?? []).map((run) => {
    if (!isTargetAgentRun(run, targetRunId, !!runId)) {
      return run;
    }

    const nextLatestSummary = patch.latestSummary ?? run.latestSummary;
    const nextSummary = mergeAgentRunSummary(run.summary, patch);
    if (
      nextLatestSummary === run.latestSummary &&
      areAgentRunSummariesEqual(run.summary, nextSummary)
    ) {
      return run;
    }

    didUpdate = true;
    return {
      ...run,
      updatedAt: Math.max(run.updatedAt, timestamp),
      latestSummary: nextLatestSummary,
      summary: nextSummary,
    };
  });

  return didUpdate
    ? {
        ...conversation,
        updatedAt: Math.max(conversation.updatedAt, timestamp),
        agentRuns: nextRuns,
      }
    : conversation;
}

export function completeAgentRunInConversation(
  conversation: Conversation,
  params?: {
    checkpointDetail?: string;
    checkpointKind?: AgentRunCheckpointKind;
    checkpointTitle?: string;
    latestSummary?: string;
    status?: Exclude<AgentRunStatus, 'running'>;
    summary?: Partial<AgentRunSummary>;
    terminalReason?: AgentRunTerminalReason;
    timestamp?: number;
  },
  runId?: string,
): Conversation {
  const targetRunId = resolveTargetAgentRunId(conversation, runId);
  if (!targetRunId) {
    return conversation;
  }

  const timestamp = params?.timestamp ?? Date.now();
  const finalStatus = params?.status ?? 'completed';
  let nextMessages = conversation.messages;
  let didUpdate = false;
  const nextRuns = (conversation.agentRuns ?? []).map((run) => {
    if (!isTargetAgentRun(run, targetRunId)) {
      return run;
    }

    const settledToolCalls = settleActiveToolCallsInAgentRunMessages({
      messages: nextMessages,
      run,
      timestamp,
      errorMessage: buildTerminalRunToolCallError(finalStatus),
    });
    if (settledToolCalls.settledCount > 0) {
      nextMessages = settledToolCalls.messages;
    }

    didUpdate = true;
    const finalPhase = finalStatus === 'completed' ? 'deliver' : run.currentPhase;
    const nextControlGraph = updateAgentRunControlGraphAsyncWorkState(run.controlGraph, {
      awaitingBackgroundWorkers: false,
      pendingOperations: [],
      updatedAt: timestamp,
    });
    let nextRun: AgentRun = {
      ...run,
      status: finalStatus,
      controlGraph: nextControlGraph,
      currentPhase: finalPhase,
      completedAt: timestamp,
      updatedAt: Math.max(run.updatedAt, timestamp),
      latestSummary: params?.latestSummary ?? run.latestSummary,
      terminalReason: params?.terminalReason ?? run.terminalReason,
      summary: mergeAgentRunSummary(run.summary, params?.summary),
      phases: transitionAgentRunPhases(
        run.phases,
        finalPhase,
        finalStatus === 'completed' ? 'completed' : finalStatus === 'failed' ? 'failed' : 'skipped',
        timestamp,
        params?.latestSummary,
      ),
    };

    if (finalStatus !== 'completed') {
      nextRun = {
        ...nextRun,
        phases: skipRemainingAgentRunPhases(nextRun.phases, finalPhase, timestamp),
      };
    }

    return params?.checkpointTitle
      ? appendAgentCheckpoint(nextRun, {
          timestamp,
          kind: params.checkpointKind ?? 'run',
          title: params.checkpointTitle,
          detail: params.checkpointDetail ?? params.latestSummary,
        })
      : nextRun;
  });

  return didUpdate
    ? {
        ...conversation,
        updatedAt: Math.max(conversation.updatedAt, timestamp),
        messages: nextMessages,
        agentRuns: nextRuns,
        activeAgentRunId:
          conversation.activeAgentRunId === targetRunId ? undefined : conversation.activeAgentRunId,
      }
    : conversation;
}
