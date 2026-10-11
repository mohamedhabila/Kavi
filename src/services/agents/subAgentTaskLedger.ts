import type {
  AgentPlanStep,
  AgentRunControlGraphState,
  AgentRunTaskLedgerItem,
  AgentRunTaskStatus,
} from '../../types/agentRun';

function planStepStatusToTaskStatus(status: AgentPlanStep['status']): AgentRunTaskStatus {
  switch (status) {
    case 'completed':
      return 'done';
    case 'in_progress':
      return 'active';
    default:
      return 'pending';
  }
}

/** A worker's progress, as the plan it keeps with update_plan states it. */
export function selectSubAgentTaskLedger(
  graphState: AgentRunControlGraphState | undefined,
): AgentRunTaskLedgerItem[] {
  return (graphState?.plan ?? []).map((step, index) => ({
    id: `step-${index + 1}`,
    title: step.step,
    status: planStepStatusToTaskStatus(step.status),
    owner: 'worker',
  }));
}

export function buildSubAgentTaskLedgerSignature(
  ledger: ReadonlyArray<AgentRunTaskLedgerItem>,
): string {
  return ledger.map((item) => [item.id, item.status, item.title].join(':')).join('|');
}

export function describeActiveSubAgentTask(
  ledger: ReadonlyArray<AgentRunTaskLedgerItem>,
): string | undefined {
  const activeTask = ledger.find((item) => item.status === 'active');
  return activeTask ? `Task: ${activeTask.title}` : undefined;
}
