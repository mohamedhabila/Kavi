import type { AgentPlanStep, AgentRun, AgentRunStatus } from '../../types/agentRun';
import { buildAgentRunTrace, type AgentRunTraceIteration } from '../../services/agents/runTrace';
import type { AgentRunExecutionPresentation } from '../../services/agents/activeConversationExecutionState';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export interface AgentWorkflowPresentation {
  /** The step the run is on: the one in progress, else the next one pending. */
  currentStep?: AgentPlanStep;
  detail?: string;
  /** The plan the model keeps with update_plan, in its own words. */
  plan: AgentPlanStep[];
  statusLabel: string;
  title: string;
  trace: AgentRunTraceIteration[];
  traceEventCount: number;
}

export function formatRunStatusLabel(
  status: AgentRunStatus,
  t: TranslateFn,
  executionPresentation?: AgentRunExecutionPresentation,
): string {
  if (status === 'running' && executionPresentation === 'waiting_for_user') {
    return t('chat.agentPlan.status.waitingForYou');
  }
  if (status === 'running' && executionPresentation === 'needs_attention') {
    return t('chat.agentPlan.status.needsAttention');
  }

  switch (status) {
    case 'completed':
      return t('chat.agentPlan.status.completed');
    case 'failed':
      return t('chat.agentPlan.status.failed');
    case 'cancelled':
      return t('chat.agentPlan.status.cancelled');
    default:
      return t('chat.agentPlan.status.running');
  }
}

export function formatPlanStepStatusLabel(status: AgentPlanStep['status'], t: TranslateFn): string {
  switch (status) {
    case 'pending':
      return t('chat.agentPlan.stepStatus.pending');
    case 'in_progress':
      return t('chat.agentPlan.stepStatus.inProgress');
    case 'completed':
      return t('chat.agentPlan.stepStatus.completed');
  }
}

function resolveCurrentStep(plan: ReadonlyArray<AgentPlanStep>): AgentPlanStep | undefined {
  return (
    plan.find((entry) => entry.status === 'in_progress') ??
    plan.find((entry) => entry.status === 'pending')
  );
}

export function buildAgentWorkflowPresentation(
  run: AgentRun,
  t: TranslateFn,
  executionPresentation?: AgentRunExecutionPresentation,
): AgentWorkflowPresentation {
  const plan = run.controlGraph?.plan ?? [];
  const activePhase =
    run.phases.find((phase) => phase.key === run.currentPhase) ??
    run.phases.find((phase) => phase.status === 'active');
  const currentStep = resolveCurrentStep(plan);
  const trace = buildAgentRunTrace(run.controlGraph);

  return {
    currentStep,
    detail: activePhase?.detail ?? run.latestSummary,
    plan,
    statusLabel: formatRunStatusLabel(run.status, t, executionPresentation),
    title: currentStep?.step ?? activePhase?.title ?? run.goal,
    trace,
    traceEventCount: trace.reduce((count, entry) => count + entry.events.length, 0),
  };
}
