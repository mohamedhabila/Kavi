import type { AgentRunStatus } from '../../types/agentRun';
import type { AgentRunFinalizationEvidence } from './lifecycle/finalizePhaseTypes';
import { selectSingleTerminalDeliverableOutput } from './finalizationDeliverables';

export function buildMissingFinalResponseFallback(
  status: Exclude<AgentRunStatus, 'running'>,
): string {
  switch (status) {
    case 'failed':
      return 'The run failed before it generated a final response.';
    case 'cancelled':
      return 'The run was cancelled before it generated a final response.';
    default:
      return 'The run completed, but no final response was generated.';
  }
}

function selectAgentRunDirectTerminalFinalOutput(
  evidence: Pick<AgentRunFinalizationEvidence, 'terminalDeliverables'>,
): string | undefined {
  return selectSingleTerminalDeliverableOutput(evidence.terminalDeliverables ?? []);
}

export function buildAgentRunCompletionFallbackOutput(params: {
  status: Exclude<AgentRunStatus, 'running'>;
  evidence: AgentRunFinalizationEvidence;
}): string | undefined {
  if (params.status === 'completed') {
    const directTerminalOutput = selectAgentRunDirectTerminalFinalOutput(params.evidence);
    if (directTerminalOutput) {
      return directTerminalOutput;
    }
  }
  return undefined;
}
