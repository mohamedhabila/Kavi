import type { OrchestratorTerminalDisposition } from '../../engine/orchestrator/types';
import type { SubAgentCompletionState, SubAgentConfig, SubAgentResult } from '../../types/subAgent';
import {
  FINALIZATION_OUTPUT_TRUNCATION,
  normalizeFinalizationOutputText,
} from './finalizationText';
import {
  hasOperationalEvidenceFromSources,
  hasVerificationEvidenceFromSources,
} from './approvalSignals';

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
 * Whether an answer-only worker delivered what it was asked for, read from what the
 * runtime observed rather than from text the worker had to append.
 *
 * The worker contract tells such a worker that the runtime tracks its completion state
 * and to focus on the report. The runtime only did that for workers that used tools, so a
 * worker that answered directly — exactly as asked — ended with no state, was filed as
 * incomplete, and its goal never received worker evidence (`delegation-worker-finalize`,
 * live: the worker returned the requested token in 1.2 s and the supervisor blocked).
 * Its run completing with a final answer candidate and a non-empty report is that
 * delivery. A state the worker declares itself still wins.
 */
function hasDeliveredInformationAnswer(params: {
  deliverableKind?: SubAgentConfig['deliverableKind'];
  terminalStatus: SubAgentResult['status'];
  terminalDisposition?: OrchestratorTerminalDisposition;
  report: string;
}): boolean {
  return (
    params.deliverableKind === 'information' &&
    params.terminalStatus === 'completed' &&
    params.terminalDisposition === 'final_candidate' &&
    params.report.length > 0
  );
}

export function enforceExecutionWorkerOutputContract(params: {
  output: string;
  completionState?: SubAgentCompletionState;
  toolsUsed: string[];
  toolResultPreviews: SubAgentToolResultPreview[];
  requireStructuredExecutionEvidence: boolean;
  terminalStatus: SubAgentResult['status'];
  /** How the worker's own run ended; only a completed run reports one. */
  terminalDisposition?: OrchestratorTerminalDisposition;
  deliverableKind?: SubAgentConfig['deliverableKind'];
  outputTruncation?: number;
}): EnforcedExecutionWorkerOutput {
  const outputTruncation = params.outputTruncation ?? FINALIZATION_OUTPUT_TRUNCATION;
  const normalizedOutput = normalizeFinalizationOutputText(params.output, outputTruncation);
  if (!normalizedOutput) {
    return { output: params.output };
  }

  const declaredCompletionState =
    params.completionState ?? extractWorkerCompletionState(normalizedOutput);
  const report = stripWorkerReport(normalizedOutput, outputTruncation);
  const visibleOutput = report || buildWorkerFallbackOutput(params.terminalStatus);

  if (!params.requireStructuredExecutionEvidence) {
    const completionState =
      declaredCompletionState ??
      (hasDeliveredInformationAnswer({
        deliverableKind: params.deliverableKind,
        terminalStatus: params.terminalStatus,
        terminalDisposition: params.terminalDisposition,
        report,
      })
        ? 'verified_success'
        : undefined);
    return {
      output: visibleOutput,
      ...(completionState ? { completionState } : {}),
    };
  }
  const completionState = declaredCompletionState;

  const successfulResultPreviews = params.toolResultPreviews
    .filter((entry) => entry.status !== 'failed')
    .map((entry) => ({
      sourceName: entry.toolName,
      preview: entry.preview,
    }));
  const hasExecutionEvidence =
    hasOperationalEvidenceFromSources({
      resultPreviewEntries: successfulResultPreviews,
      includeOpaqueDynamicToolResults: true,
    }) ||
    hasVerificationEvidenceFromSources({
      resultPreviewEntries: successfulResultPreviews,
    });

  if (params.terminalStatus !== 'completed') {
    return {
      output: visibleOutput,
      completionState: completionState === 'blocked' ? 'blocked' : 'incomplete',
    };
  }

  if (completionState === 'verified_success') {
    return {
      output: visibleOutput,
      completionState: hasExecutionEvidence ? 'verified_success' : 'blocked',
    };
  }

  if (completionState === 'blocked' || completionState === 'incomplete') {
    return {
      output: visibleOutput,
      completionState,
    };
  }

  return {
    output: visibleOutput,
    completionState: 'incomplete',
  };
}
