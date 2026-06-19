import type {
  AgentRunPhase,
  AgentRunPhaseKey,
  AgentRunPhaseStatus,
  AgentRunPlan,
  AgentRunSummary,
  AgentRunWorkstream,
} from '../../types/agentRun';
import { normalizeWorkflowWorkstreams } from './workflowSchedulingReferences';

export const DEFAULT_AGENT_RUN_SUCCESS_CRITERIA = [
  'Produce the requested deliverable.',
  'Verify the result before finalizing.',
];

export const DEFAULT_AGENT_RUN_STOP_CONDITIONS = [
  'Stop when the deliverable is complete and the success criteria are satisfied.',
  'Stop early if a concrete blocker, missing permission, or dependency prevents further progress.',
];

const DEFAULT_AGENT_RUN_SUMMARY: AgentRunSummary = {
  assistantTurns: 0,
  startedTools: 0,
  completedTools: 0,
  failedTools: 0,
  spawnedSubAgents: 0,
};

export const AGENT_RUN_PHASE_DEFINITIONS: Array<{
  key: AgentRunPhaseKey;
  title: string;
}> = [
  { key: 'assess', title: 'Assess' },
  { key: 'plan', title: 'Plan' },
  { key: 'work', title: 'Work' },
  { key: 'review', title: 'Review' },
  { key: 'pilot', title: 'Pilot' },
  { key: 'deliver', title: 'Deliver' },
];

function normalizeTextList(items: string[] | undefined, fallback: string[]): string[] {
  const normalized = (items ?? []).map((item) => item.trim()).filter(Boolean);

  return normalized.length ? normalized : [...fallback];
}

function normalizeAgentRunWorkstreams(workstreams?: AgentRunWorkstream[]): AgentRunWorkstream[] {
  return normalizeWorkflowWorkstreams(workstreams);
}

export function createInitialAgentRunPhases(timestamp: number): AgentRunPhase[] {
  return AGENT_RUN_PHASE_DEFINITIONS.map((phase, index) => ({
    ...phase,
    status: index === 0 ? 'active' : 'pending',
    updatedAt: timestamp,
  }));
}

export function mergeAgentRunSummary(
  existing: AgentRunSummary | undefined,
  patch?: Partial<AgentRunSummary>,
): AgentRunSummary {
  const base = { ...DEFAULT_AGENT_RUN_SUMMARY, ...(existing ?? {}) };

  if (!patch) {
    return base;
  }

  return {
    assistantTurns: patch.assistantTurns ?? base.assistantTurns,
    startedTools: patch.startedTools ?? base.startedTools,
    completedTools: patch.completedTools ?? base.completedTools,
    failedTools: patch.failedTools ?? base.failedTools,
    spawnedSubAgents: patch.spawnedSubAgents ?? base.spawnedSubAgents,
    durationMs: patch.durationMs ?? base.durationMs,
  };
}

export function areAgentRunSummariesEqual(
  left: AgentRunSummary | undefined,
  right: AgentRunSummary | undefined,
): boolean {
  const normalizedLeft = mergeAgentRunSummary(left);
  const normalizedRight = mergeAgentRunSummary(right);

  return (
    normalizedLeft.assistantTurns === normalizedRight.assistantTurns &&
    normalizedLeft.startedTools === normalizedRight.startedTools &&
    normalizedLeft.completedTools === normalizedRight.completedTools &&
    normalizedLeft.failedTools === normalizedRight.failedTools &&
    normalizedLeft.spawnedSubAgents === normalizedRight.spawnedSubAgents &&
    normalizedLeft.durationMs === normalizedRight.durationMs
  );
}

export function createDefaultAgentRunPlan(
  goal: string,
  timestamp: number,
  rawPlan?: string,
): AgentRunPlan {
  return {
    objective: goal.trim() || 'Complete the current task.',
    successCriteria: [...DEFAULT_AGENT_RUN_SUCCESS_CRITERIA],
    stopConditions: [...DEFAULT_AGENT_RUN_STOP_CONDITIONS],
    workstreams: [],
    rawPlan: rawPlan?.trim() || undefined,
    updatedAt: timestamp,
  };
}

export function mergeAgentRunPlan(
  existing: AgentRunPlan | undefined,
  patch: Partial<AgentRunPlan> | undefined,
  fallbackGoal: string,
  timestamp: number,
): AgentRunPlan {
  const base = existing ?? createDefaultAgentRunPlan(fallbackGoal, timestamp);

  return {
    objective: patch?.objective?.trim() || base.objective || fallbackGoal,
    successCriteria: normalizeTextList(patch?.successCriteria, base.successCriteria),
    stopConditions: normalizeTextList(patch?.stopConditions, base.stopConditions),
    workstreams: normalizeAgentRunWorkstreams(patch?.workstreams ?? base.workstreams),
    rawPlan: patch?.rawPlan?.trim() || base.rawPlan,
    updatedAt: patch?.updatedAt ?? timestamp,
  };
}

export function transitionAgentRunPhases(
  phases: AgentRunPhase[],
  targetPhase: AgentRunPhaseKey,
  status: Exclude<AgentRunPhaseStatus, 'pending'>,
  timestamp: number,
  detail?: string,
  options?: { allowRegression?: boolean },
): AgentRunPhase[] {
  const targetIndex = AGENT_RUN_PHASE_DEFINITIONS.findIndex((phase) => phase.key === targetPhase);
  if (targetIndex < 0) {
    return phases;
  }

  return phases.map((phase, index) => {
    if (index < targetIndex && (phase.status === 'pending' || phase.status === 'active')) {
      return {
        ...phase,
        status: 'completed',
        updatedAt: timestamp,
      };
    }

    if (phase.key === targetPhase) {
      return {
        ...phase,
        status,
        detail: detail ?? phase.detail,
        updatedAt: timestamp,
      };
    }

    if (options?.allowRegression && index > targetIndex && phase.status === 'active') {
      return {
        ...phase,
        status: 'completed',
        updatedAt: timestamp,
      };
    }

    return phase;
  });
}

export function getAgentRunPhaseIndex(phaseKey: AgentRunPhaseKey): number {
  return AGENT_RUN_PHASE_DEFINITIONS.findIndex((phase) => phase.key === phaseKey);
}

export function areAgentRunPhasesEqual(left: AgentRunPhase[], right: AgentRunPhase[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftPhase = left[index];
    const rightPhase = right[index];

    if (
      leftPhase.key !== rightPhase.key ||
      leftPhase.title !== rightPhase.title ||
      leftPhase.status !== rightPhase.status ||
      leftPhase.detail !== rightPhase.detail
    ) {
      return false;
    }
  }

  return true;
}

export function skipRemainingAgentRunPhases(
  phases: AgentRunPhase[],
  targetPhase: AgentRunPhaseKey,
  timestamp: number,
): AgentRunPhase[] {
  const targetIndex = AGENT_RUN_PHASE_DEFINITIONS.findIndex((phase) => phase.key === targetPhase);
  if (targetIndex < 0) {
    return phases;
  }

  return phases.map((phase, index) =>
    index > targetIndex && phase.status === 'pending'
      ? {
          ...phase,
          status: 'skipped',
          updatedAt: timestamp,
        }
      : phase,
  );
}
