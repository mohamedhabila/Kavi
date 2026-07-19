import { REQUEST_CLARIFICATION_TOOL_NAME } from '../../services/agents/requestClarification';
import type { ToolCallRecord } from '../loopDetection';
import { normalizeToolName } from '../tools/toolNameNormalization';

export const CLARIFICATION_REVIEW_REQUIRED_CODE = 'clarification_review_required';

function isRuntimeExternalToolName(toolName: string): boolean {
  const normalized = normalizeToolName(toolName);
  return normalized.startsWith('mcp__') || normalized.startsWith('skill__');
}

function isPriorReviewBlock(entry: ToolCallRecord): boolean {
  if (
    normalizeToolName(entry.name) !== REQUEST_CLARIFICATION_TOOL_NAME ||
    entry.status !== 'failed' ||
    typeof entry.result !== 'string'
  ) {
    return false;
  }
  try {
    const result = JSON.parse(entry.result) as Record<string, unknown>;
    return result.code === CLARIFICATION_REVIEW_REQUIRED_CODE;
  } catch {
    return false;
  }
}

/**
 * Opaque integrations are discovered and operated by the assistant, not the user.
 * After one has already worked in this run, require one bounded second look before
 * transferring a supposedly missing integration detail back to the user.
 */
export function buildClarificationReviewBlock(params: {
  toolName: string;
  toolCallHistory: ReadonlyArray<ToolCallRecord>;
}): string | undefined {
  if (normalizeToolName(params.toolName) !== REQUEST_CLARIFICATION_TOOL_NAME) {
    return undefined;
  }
  if (params.toolCallHistory.some(isPriorReviewBlock)) {
    return undefined;
  }
  const runtimeIntegrationAlreadyWorked = params.toolCallHistory.some(
    (entry) => entry.status === 'completed' && isRuntimeExternalToolName(entry.name),
  );
  if (!runtimeIntegrationAlreadyWorked) {
    return undefined;
  }

  return JSON.stringify({
    status: 'error',
    code: CLARIFICATION_REVIEW_REQUIRED_CODE,
    error:
      'Clarification was not registered yet because a runtime integration already completed in this run.',
    retryable: true,
    sideEffectApplied: false,
    recovery: {
      requiredAction:
        'Re-evaluate the original request and active integration tools. Reuse a previously successful read or verification tool when it can resolve the remaining step. Reissue request_clarification only if a specific user-owned value or choice is still unavailable after the available tool paths are exhausted.',
    },
  });
}
