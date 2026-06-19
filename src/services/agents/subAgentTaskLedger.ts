import type {
  AgentGoal,
  AgentRunControlGraphState,
  AgentRunTaskLedgerItem,
  AgentRunTaskStatus,
} from '../../types/agentRun';

function cloneStringList(values: ReadonlyArray<string>): string[] | undefined {
  return values.length > 0 ? [...values] : undefined;
}

function goalStatusToTaskStatus(status: AgentGoal['status']): AgentRunTaskStatus {
  switch (status) {
    case 'completed':
      return 'done';
    case 'active':
      return 'active';
    default:
      return 'pending';
  }
}

function goalToTaskLedgerItem(goal: AgentGoal): AgentRunTaskLedgerItem {
  const owner =
    goal.owner === 'supervisor' || goal.owner === 'worker' || goal.owner === 'either'
      ? goal.owner
      : 'either';

  return {
    id: goal.id,
    title: goal.title,
    status: goalStatusToTaskStatus(goal.status),
    owner,
    ...(goal.description ? { goal: goal.description } : {}),
    ...(goal.dependencies.length > 0 ? { dependencies: cloneStringList(goal.dependencies) } : {}),
    ...(goal.requiredCapabilities?.length
      ? { requiredCapabilities: cloneStringList(goal.requiredCapabilities) }
      : {}),
    ...(goal.evidence.length > 0 ? { completedEvidence: cloneStringList(goal.evidence) } : {}),
  };
}

export function selectSubAgentTaskLedger(
  graphState: AgentRunControlGraphState | undefined,
): AgentRunTaskLedgerItem[] {
  return (graphState?.goals ?? []).map(goalToTaskLedgerItem);
}

export function buildSubAgentTaskLedgerSignature(
  ledger: ReadonlyArray<AgentRunTaskLedgerItem>,
): string {
  return ledger
    .map((item) =>
      [
        item.id,
        item.status,
        item.goal ?? '',
        item.requirements?.join(',') ?? '',
        item.requiredCapabilities?.join(',') ?? '',
        item.completedEvidence?.join(',') ?? '',
      ].join(':'),
    )
    .join('|');
}

export function describeActiveSubAgentTask(
  ledger: ReadonlyArray<AgentRunTaskLedgerItem>,
): string | undefined {
  const activeTask = ledger.find((item) => item.status === 'active');
  return activeTask ? `Task: ${activeTask.title}` : undefined;
}
