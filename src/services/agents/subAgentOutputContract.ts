import type { SubAgentCompletionState, SubAgentResult } from '../../types/subAgent';
import {
  FINALIZATION_OUTPUT_TRUNCATION,
  normalizeFinalizationOutputText,
} from './finalizationText';
import { hasOperationalEvidenceFromSources } from './approvalSignals';

export type SubAgentToolResultPreview = {
  toolName: string;
  preview: string;
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

function extractWorkerCompletionState(output: string): SubAgentCompletionState | undefined {
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

function resolveVisibleWorkerOutput(
  output: string,
  terminalStatus: SubAgentResult['status'],
  outputTruncation: number,
): string {
  const strippedOutput = normalizeFinalizationOutputText(
    stripWorkerMetadataLines(output),
    outputTruncation,
  );
  return strippedOutput || buildWorkerFallbackOutput(terminalStatus);
}

export function enforceExecutionWorkerOutputContract(params: {
  output: string;
  completionState?: SubAgentCompletionState;
  toolsUsed: string[];
  toolResultPreviews: SubAgentToolResultPreview[];
  requireStructuredExecutionEvidence: boolean;
  terminalStatus: SubAgentResult['status'];
  outputTruncation?: number;
}): EnforcedExecutionWorkerOutput {
  const normalizedOutput = normalizeFinalizationOutputText(
    params.output,
    params.outputTruncation ?? FINALIZATION_OUTPUT_TRUNCATION,
  );
  if (!normalizedOutput) {
    return { output: params.output };
  }

  const completionState = params.completionState ?? extractWorkerCompletionState(normalizedOutput);
  const visibleOutput = resolveVisibleWorkerOutput(
    normalizedOutput,
    params.terminalStatus,
    params.outputTruncation ?? FINALIZATION_OUTPUT_TRUNCATION,
  );

  if (!params.requireStructuredExecutionEvidence) {
    return {
      output: visibleOutput,
      ...(completionState ? { completionState } : {}),
    };
  }

  const hasExecutionEvidence = hasOperationalEvidenceFromSources({
    toolsUsed: params.toolsUsed,
    resultPreviewEntries: params.toolResultPreviews.map((entry) => ({
      sourceName: entry.toolName,
      preview: entry.preview,
    })),
    resultPreviewSourceNames: params.toolResultPreviews.map((entry) => entry.toolName),
    includeOpaqueDynamicToolResults: true,
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
