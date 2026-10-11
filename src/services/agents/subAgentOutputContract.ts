import type { OrchestratorTerminalDisposition } from '../../engine/orchestrator/types';
import type { SubAgentCompletionState, SubAgentResult } from '../../types/subAgent';
import {
  FINALIZATION_OUTPUT_TRUNCATION,
  normalizeFinalizationOutputText,
} from './finalizationText';

export type SubAgentToolResultPreview = {
  toolName: string;
  preview: string;
  status?: 'completed' | 'failed';
};

export type EnforcedExecutionWorkerOutput = {
  output: string;
  completionState?: SubAgentCompletionState;
};

const WORKER_METADATA_LINE_PATTERN =
  /^(completion_state|actions_taken|artifacts_verified|external_runs_verified|unverified_claims)\s*:\s*.*$/gim;

const WORKER_COMPLETION_STATE_PRECEDENCE: SubAgentCompletionState[] = [
  'incomplete',
  'blocked',
  'verified_success',
];

export function extractWorkerCompletionState(output: string): SubAgentCompletionState | undefined {
  const observed = new Set<SubAgentCompletionState>();
  for (const match of output.matchAll(/^completion_state\s*:\s*([a-z_]+)\s*$/gim)) {
    const value = match[1]?.trim();
    if (value === 'verified_success' || value === 'blocked' || value === 'incomplete') {
      observed.add(value);
    }
  }
  if (observed.size === 0) {
    return undefined;
  }
  for (const state of WORKER_COMPLETION_STATE_PRECEDENCE) {
    if (observed.has(state)) {
      return state;
    }
  }
  return undefined;
}

function stripWorkerMetadataLines(output: string): string {
  return output.replace(WORKER_METADATA_LINE_PATTERN, '').replace(/\n{3,}/g, '\n\n');
}

function buildWorkerFallbackOutput(status: SubAgentResult['status']): string {
  switch (status) {
    case 'cancelled':
      return 'Worker was cancelled before producing a visible report.';
    case 'timeout':
      return 'Worker timed out before producing a visible report.';
    case 'error':
      return 'Worker ended with an error before producing a visible report.';
    default:
      return 'Worker completed without a visible report.';
  }
}

function stripWorkerReport(output: string, outputTruncation: number): string {
  return normalizeFinalizationOutputText(stripWorkerMetadataLines(output), outputTruncation) ?? '';
}

/**
 * Whether a worker delivered what it was asked for, read from what the runtime observed
 * rather than from what anyone claims: its run completed, ended with a final answer, and
 * left a non-empty report. The parent reads that report as the worker's result, the way
 * a tool result is read.
 */
function hasDeliveredAnswer(params: {
  terminalStatus: SubAgentResult['status'];
  terminalDisposition?: OrchestratorTerminalDisposition;
  report: string;
}): boolean {
  return (
    params.terminalStatus === 'completed' &&
    params.terminalDisposition === 'final_candidate' &&
    params.report.length > 0
  );
}

/**
 * Success is the runtime's call: only a delivered answer is `verified_success`. A state
 * the worker declares can say less — blocked or incomplete — never more.
 */
export function enforceExecutionWorkerOutputContract(params: {
  output: string;
  completionState?: SubAgentCompletionState;
  terminalStatus: SubAgentResult['status'];
  /** How the worker's own run ended; only a completed run reports one. */
  terminalDisposition?: OrchestratorTerminalDisposition;
  outputTruncation?: number;
}): EnforcedExecutionWorkerOutput {
  const outputTruncation = params.outputTruncation ?? FINALIZATION_OUTPUT_TRUNCATION;
  const normalizedOutput = normalizeFinalizationOutputText(params.output, outputTruncation);
  if (!normalizedOutput) {
    return { output: params.output };
  }

  const report = stripWorkerReport(normalizedOutput, outputTruncation);
  const declared = params.completionState ?? extractWorkerCompletionState(normalizedOutput);
  const completionState: SubAgentCompletionState =
    declared === 'blocked' || declared === 'incomplete'
      ? declared
      : hasDeliveredAnswer({
            terminalStatus: params.terminalStatus,
            terminalDisposition: params.terminalDisposition,
            report,
          })
        ? 'verified_success'
        : 'incomplete';
  return {
    output: report || buildWorkerFallbackOutput(params.terminalStatus),
    completionState,
  };
}
