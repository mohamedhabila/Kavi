import { AgentRun, AgentRunCheckpoint, AgentRunPhase } from '../../../types/agentRun';
import { formatCompactElapsed } from './presentPhase';

export function formatAgentRunStatusLabel(status: AgentRun['status']): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Running';
  }
}

export function buildAgentRunSummaryText(summary?: AgentRun['summary']): string | undefined {
  if (!summary) {
    return undefined;
  }

  const parts = [
    `Turns ${summary.assistantTurns}`,
    `Tools ${summary.completedTools}/${summary.startedTools}`,
  ];

  if (summary.failedTools > 0) {
    parts.push(`Failed ${summary.failedTools}`);
  }

  if (summary.spawnedSubAgents > 0) {
    parts.push(`Workers ${summary.spawnedSubAgents}`);
  }

  if (summary.durationMs && summary.durationMs > 0) {
    parts.push(formatCompactElapsed(summary.durationMs));
  }

  return parts.join(' · ');
}

export function formatAgentRunCheckpointKind(
  kind: AgentRun['checkpoints'][number]['kind'],
): string {
  switch (kind) {
    case 'phase':
      return 'Phase';
    case 'tool':
      return 'Tool';
    case 'sub-agent':
      return 'Worker';
    case 'note':
      return 'Note';
    default:
      return 'Run';
  }
}

export function getAgentRunDisplayPhase(run: AgentRun): AgentRunPhase | undefined {
  if (!run.phases.length) {
    return undefined;
  }

  const activePhase = run.phases.find((phase) => phase.status === 'active');
  if (activePhase) {
    return activePhase;
  }

  const currentPhase = run.phases.find((phase) => phase.key === run.currentPhase);
  if (currentPhase) {
    return currentPhase;
  }

  return (
    [...run.phases]
      .reverse()
      .find(
        (phase) =>
          phase.status === 'completed' || phase.status === 'failed' || phase.status === 'skipped',
      ) ?? run.phases[0]
  );
}

export function getLatestAgentRunToolCheckpoint(run: AgentRun): AgentRunCheckpoint | undefined {
  return [...run.checkpoints].reverse().find((checkpoint) => checkpoint.kind === 'tool');
}

export function extractToolNameFromCheckpointTitle(title: string): string | undefined {
  const normalized = title.trim();
  if (!normalized) {
    return undefined;
  }

  const match = normalized.match(/^Tool(?:\s+\w+)?\s*:\s*(.+)$/i);
  return match?.[1]?.trim() || undefined;
}
