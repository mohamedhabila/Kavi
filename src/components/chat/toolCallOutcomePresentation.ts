import type { ToolCall } from '../../types/message';

export interface ToolCallFailurePresentation {
  tone: 'danger' | 'warning';
  titleKey: string;
  detailKey: string;
}

function buildFailureEvidence(toolCall: ToolCall): string {
  return [toolCall.failureKind, toolCall.error, toolCall.result]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => value.slice(0, 8_000).toLowerCase())
    .join('\n');
}

export function getToolCallFailurePresentation(
  toolCall: ToolCall,
): ToolCallFailurePresentation | null {
  if (toolCall.status !== 'failed') {
    return null;
  }

  const evidence = buildFailureEvidence(toolCall);

  if (evidence.includes('tool_effect_reconciliation_required')) {
    return {
      tone: 'warning',
      titleKey: 'toolCall.outcomes.uncertainTitle',
      detailKey: 'toolCall.outcomes.uncertainDetail',
    };
  }

  if (
    evidence.includes('user_approval_denied') ||
    evidence.includes('approval denied') ||
    evidence.includes('not approved')
  ) {
    return {
      tone: 'warning',
      titleKey: 'toolCall.outcomes.declinedTitle',
      detailKey: 'toolCall.outcomes.declinedDetail',
    };
  }

  if (
    /permission denied|\bunauthorized\b|\bforbidden\b|\b401\b|\b403\b/.test(evidence)
  ) {
    return {
      tone: 'danger',
      titleKey: 'toolCall.outcomes.accessTitle',
      detailKey: 'toolCall.outcomes.accessDetail',
    };
  }

  if (
    toolCall.failureKind === 'unknown_tool' ||
    toolCall.failureKind === 'tool_filter' ||
    evidence.includes('unknown tool') ||
    evidence.includes('tool is not available')
  ) {
    return {
      tone: 'danger',
      titleKey: 'toolCall.outcomes.unavailableTitle',
      detailKey: 'toolCall.outcomes.unavailableDetail',
    };
  }

  if (/\boffline\b|\bnetwork\b|\btimeout\b|timed out|connection|\bdns\b|econn/.test(evidence)) {
    return {
      tone: 'danger',
      titleKey: 'toolCall.outcomes.connectionTitle',
      detailKey: 'toolCall.outcomes.connectionDetail',
    };
  }

  if (toolCall.failureKind === 'authority_revoked' || toolCall.failureKind === 'workflow_guard') {
    return {
      tone: 'warning',
      titleKey: 'toolCall.outcomes.stoppedTitle',
      detailKey: 'toolCall.outcomes.stoppedDetail',
    };
  }

  return {
    tone: 'danger',
    titleKey: 'toolCall.outcomes.failedTitle',
    detailKey: 'toolCall.outcomes.failedDetail',
  };
}
