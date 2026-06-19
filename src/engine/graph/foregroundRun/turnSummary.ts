import { formatCompactElapsed } from '../../../services/agents/lifecycle/presentPhase';

export function buildForegroundRunTurnSummary(params: {
  durationMs: number;
  assistantTurns: number;
  startedTools: number;
  completedTools: number;
  failedTools: number;
  spawnedSubAgents: number;
}): string {
  const parts = [
    `duration ${formatCompactElapsed(Math.max(0, params.durationMs))}`,
    `assistant turns ${params.assistantTurns}`,
  ];

  if (params.startedTools > 0) {
    parts.push(`tools ${params.completedTools}/${params.startedTools}`);
  }

  if (params.failedTools > 0) {
    parts.push(`failed ${params.failedTools}`);
  }

  if (params.spawnedSubAgents > 0) {
    parts.push(`sub-agents ${params.spawnedSubAgents}`);
  }

  return parts.join(' · ');
}
