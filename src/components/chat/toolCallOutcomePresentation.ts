import type { ToolCall, ToolCallFailureKind } from '../../types/message';

export interface ToolCallFailurePresentation {
  tone: 'danger' | 'warning';
  titleKey: string;
  detailKey: string;
}

const UNCERTAIN_PRESENTATION: ToolCallFailurePresentation = {
  tone: 'warning',
  titleKey: 'toolCall.outcomes.uncertainTitle',
  detailKey: 'toolCall.outcomes.uncertainDetail',
};

const DECLINED_PRESENTATION: ToolCallFailurePresentation = {
  tone: 'warning',
  titleKey: 'toolCall.outcomes.declinedTitle',
  detailKey: 'toolCall.outcomes.declinedDetail',
};

const ACCESS_PRESENTATION: ToolCallFailurePresentation = {
  tone: 'danger',
  titleKey: 'toolCall.outcomes.accessTitle',
  detailKey: 'toolCall.outcomes.accessDetail',
};

const UNAVAILABLE_PRESENTATION: ToolCallFailurePresentation = {
  tone: 'danger',
  titleKey: 'toolCall.outcomes.unavailableTitle',
  detailKey: 'toolCall.outcomes.unavailableDetail',
};

const CONNECTION_PRESENTATION: ToolCallFailurePresentation = {
  tone: 'danger',
  titleKey: 'toolCall.outcomes.connectionTitle',
  detailKey: 'toolCall.outcomes.connectionDetail',
};

const STOPPED_PRESENTATION: ToolCallFailurePresentation = {
  tone: 'warning',
  titleKey: 'toolCall.outcomes.stoppedTitle',
  detailKey: 'toolCall.outcomes.stoppedDetail',
};

// Not a failure: the run finished without waiting for this call. Rendering it in red
// told the reader something had gone wrong in a run that had in fact succeeded.
const NOT_AWAITED_PRESENTATION: ToolCallFailurePresentation = {
  tone: 'warning',
  titleKey: 'toolCall.outcomes.notAwaitedTitle',
  detailKey: 'toolCall.outcomes.notAwaitedDetail',
};

const GENERIC_FAILED_PRESENTATION: ToolCallFailurePresentation = {
  tone: 'danger',
  titleKey: 'toolCall.outcomes.failedTitle',
  detailKey: 'toolCall.outcomes.failedDetail',
};

/**
 * Closed mapping from a tool call's structured `failureKind` to the tone and
 * copy shown for it. This is the ONLY input to presentation — never the
 * `result`/`error` text, which may be reworded, machine-generated JSON, or in
 * any language. A tool call with no `failureKind` (or one this table does not
 * recognize) renders `GENERIC_FAILED_PRESENTATION`, never a sniffed guess.
 */
const FAILURE_KIND_PRESENTATION: Partial<Record<ToolCallFailureKind, ToolCallFailurePresentation>> =
  {
    reconciliation_required: UNCERTAIN_PRESENTATION,
    approval_denied: DECLINED_PRESENTATION,
    permission: ACCESS_PRESENTATION,
    auth: ACCESS_PRESENTATION,
    unknown_tool: UNAVAILABLE_PRESENTATION,
    tool_filter: UNAVAILABLE_PRESENTATION,
    not_found: UNAVAILABLE_PRESENTATION,
    unavailable: UNAVAILABLE_PRESENTATION,
    provider: UNAVAILABLE_PRESENTATION,
    network: CONNECTION_PRESENTATION,
    timeout: CONNECTION_PRESENTATION,
    rate_limited: CONNECTION_PRESENTATION,
    not_awaited: NOT_AWAITED_PRESENTATION,
    authority_revoked: STOPPED_PRESENTATION,
    workflow_guard: STOPPED_PRESENTATION,
    aborted: STOPPED_PRESENTATION,
  };

export function getToolCallFailurePresentation(
  toolCall: ToolCall,
): ToolCallFailurePresentation | null {
  if (toolCall.status !== 'failed') {
    return null;
  }

  const failureKind = toolCall.failureKind;
  if (failureKind && FAILURE_KIND_PRESENTATION[failureKind]) {
    return FAILURE_KIND_PRESENTATION[failureKind]!;
  }

  return GENERIC_FAILED_PRESENTATION;
}
