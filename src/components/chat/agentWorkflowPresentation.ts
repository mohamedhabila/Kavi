import type { AgentGoal, AgentRun, AgentRunStatus } from '../../types/agentRun';
import { buildAgentRunTrace, type AgentRunTraceIteration } from '../../services/agents/runTrace';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export interface AgentWorkflowPresentation {
  activeGoal?: AgentGoal;
  detail?: string;
  goals: AgentGoal[];
  statusLabel: string;
  title: string;
  trace: AgentRunTraceIteration[];
  traceEventCount: number;
}

export function formatRunStatusLabel(status: AgentRunStatus, t: TranslateFn): string {
  switch (status) {
    case 'completed':
      return t('chat.agentGoals.status.completed');
    case 'failed':
      return t('chat.agentGoals.status.failed');
    case 'cancelled':
      return t('chat.agentGoals.status.cancelled');
    default:
      return t('chat.agentGoals.status.running');
  }
}

export function formatGoalStatusLabel(status: AgentGoal['status'], t: TranslateFn): string {
  switch (status) {
    case 'pending':
      return t('chat.agentGoals.goalStatus.pending');
    case 'active':
      return t('chat.agentGoals.goalStatus.active');
    case 'completed':
      return t('chat.agentGoals.goalStatus.completed');
    case 'blocked':
      return t('chat.agentGoals.goalStatus.blocked');
  }
}

function resolvePrimaryGoal(goals: AgentGoal[]): AgentGoal | undefined {
  return (
    goals.find((goal) => goal.status === 'active') ??
    goals.find((goal) => goal.status === 'blocked') ??
    goals.find((goal) => goal.status === 'pending') ??
    goals[0]
  );
}

export function buildAgentWorkflowPresentation(
  run: AgentRun,
  t: TranslateFn,
): AgentWorkflowPresentation {
  const goals = run.controlGraph?.goals ?? [];
  const activePhase =
    run.phases.find((phase) => phase.key === run.currentPhase) ??
    run.phases.find((phase) => phase.status === 'active');
  const activeGoal = resolvePrimaryGoal(goals);
  const trace = buildAgentRunTrace(run.controlGraph);

  return {
    activeGoal,
    detail: activePhase?.detail ?? run.latestSummary,
    goals,
    statusLabel: formatRunStatusLabel(run.status, t),
    title: activeGoal?.title ?? activePhase?.title ?? run.goal,
    trace,
    traceEventCount: trace.reduce((count, entry) => count + entry.events.length, 0),
  };
}
