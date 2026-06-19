import type { AgentRunStatus } from '../../types/agentRun';
import type { AgentRunFinalizationEvidence } from '../../services/agents/lifecycle/finalizePhaseTypes';
import {
  FINALIZATION_OUTPUT_TRUNCATION,
  FINALIZATION_RESULT_PREVIEW_CHARS,
  normalizeFinalizationOutputText,
  normalizeFinalizationPreviewText,
} from '../../services/agents/finalizationText';
import { isApprovalGradeSourceName } from '../../services/agents/approvalSignals';

export type AgentControlGraphFinalResponseRecoveryDecision =
  | {
      type: 'recover';
      reason: 'verified_evidence' | 'terminal_status' | 'assistant_draft_synthesis';
    }
  | {
      type: 'skip';
      reason: 'missing_provider_context' | 'incomplete_tool_calls' | 'no_recoverable_evidence';
    };

export function hasAgentControlGraphVerifiedFinalizationEvidence(
  evidence: Pick<
    AgentRunFinalizationEvidence,
    'lastSubstantiveResult' | 'lastSubstantiveResultSourceName' | 'resultPreviews'
  >,
): boolean {
  if (
    normalizeFinalizationOutputText(
      evidence.lastSubstantiveResult,
      FINALIZATION_OUTPUT_TRUNCATION,
    ) &&
    isApprovalGradeSourceName(evidence.lastSubstantiveResultSourceName)
  ) {
    return true;
  }

  return evidence.resultPreviews.some(
    (entry) =>
      isApprovalGradeSourceName(entry.sourceName) &&
      !!normalizeFinalizationPreviewText(entry.preview, FINALIZATION_RESULT_PREVIEW_CHARS),
  );
}

export function buildAgentControlGraphFinalResponseRecoveryDecision(params: {
  evidence: AgentRunFinalizationEvidence;
  hasProviderContext: boolean;
  status: Exclude<AgentRunStatus, 'running'>;
}): AgentControlGraphFinalResponseRecoveryDecision {
  if (hasAgentControlGraphVerifiedFinalizationEvidence(params.evidence)) {
    return { type: 'recover', reason: 'verified_evidence' };
  }

  if (params.status !== 'completed') {
    return { type: 'recover', reason: 'terminal_status' };
  }

  if (!params.hasProviderContext) {
    return { type: 'skip', reason: 'missing_provider_context' };
  }

  if (params.evidence.hasIncompleteToolCalls) {
    return { type: 'skip', reason: 'incomplete_tool_calls' };
  }

  if (params.evidence.lastNonEmptyAssistantContent.trim().length > 0) {
    return { type: 'recover', reason: 'assistant_draft_synthesis' };
  }

  return { type: 'skip', reason: 'no_recoverable_evidence' };
}
