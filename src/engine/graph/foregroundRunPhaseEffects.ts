import type { AgentRun, AgentRunSummary, AgentRunTerminalReason } from '../../types/agentRun';
import type { ConversationRunCompletionEffect } from './applyRunCompletionEffect';

export type ForegroundAgentRunCounters = {
  assistantTurns: number;
  startedTools: number;
  completedTools: number;
  failedTools: number;
  spawnedSubAgents: number;
  runStartedAt: number;
};

export type ForegroundAgentRunPhaseEffect = {
  phase: 'assess' | 'work' | 'review';
  latestSummary: string;
  params: {
    status: 'active';
    detail: string;
    checkpointTitle?: string;
    checkpointDetail: string;
    allowRegression?: true;
  };
};

export function buildForegroundAgentRunAssessPhaseEffect(
  detail = 'Analyzing the task',
): ForegroundAgentRunPhaseEffect {
  return {
    phase: 'assess',
    latestSummary: detail,
    params: {
      status: 'active',
      detail,
      checkpointDetail: detail,
    },
  };
}

export type ForegroundAgentRunCompletionEffect = {
  params: ConversationRunCompletionEffect;
};

export function buildForegroundAgentRunSummaryPatch(
  counters: ForegroundAgentRunCounters,
  latestSummary?: string,
): Partial<AgentRunSummary> & { latestSummary?: string } {
  return {
    assistantTurns: counters.assistantTurns,
    startedTools: counters.startedTools,
    completedTools: counters.completedTools,
    failedTools: counters.failedTools,
    spawnedSubAgents: counters.spawnedSubAgents,
    ...(latestSummary ? { latestSummary } : {}),
  };
}

export function buildForegroundAgentRunWorkPhaseEffect(params: {
  detail: string;
  checkpointTitle?: string;
  hasEnteredPhase: boolean;
}): ForegroundAgentRunPhaseEffect {
  return {
    phase: 'work',
    latestSummary: params.detail,
    params: {
      status: 'active',
      detail: params.detail,
      checkpointTitle: params.hasEnteredPhase
        ? undefined
        : (params.checkpointTitle ?? 'Work started'),
      checkpointDetail: params.detail,
      allowRegression: true,
    },
  };
}

export function buildForegroundAgentRunReviewPhaseEffect(params: {
  detail: string;
  checkpointTitle?: string;
  hasEnteredPhase: boolean;
}): ForegroundAgentRunPhaseEffect {
  return {
    phase: 'review',
    latestSummary: params.detail,
    params: {
      status: 'active',
      detail: params.detail,
      checkpointTitle: params.hasEnteredPhase
        ? undefined
        : (params.checkpointTitle ?? 'Review started'),
      checkpointDetail: params.detail,
    },
  };
}

export function buildForegroundAgentRunCompletionEffect(params: {
  checkpointDetail?: string;
  checkpointTitle: string;
  counters: ForegroundAgentRunCounters;
  latestSummary: string;
  now?: number;
  status: Exclude<AgentRun['status'], 'running'>;
  terminalReason?: AgentRunTerminalReason;
}): ForegroundAgentRunCompletionEffect {
  const durationMs = Math.max(0, (params.now ?? Date.now()) - params.counters.runStartedAt);
  return {
    params: {
      status: params.status,
      latestSummary: params.latestSummary,
      checkpointTitle: params.checkpointTitle,
      checkpointDetail: params.checkpointDetail,
      ...(params.terminalReason ? { terminalReason: params.terminalReason } : {}),
      summary: {
        assistantTurns: params.counters.assistantTurns,
        startedTools: params.counters.startedTools,
        completedTools: params.counters.completedTools,
        failedTools: params.counters.failedTools,
        spawnedSubAgents: params.counters.spawnedSubAgents,
        durationMs,
      },
    },
  };
}
