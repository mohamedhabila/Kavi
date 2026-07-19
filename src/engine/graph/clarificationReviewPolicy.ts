import { REQUEST_CLARIFICATION_TOOL_NAME } from '../../services/agents/requestClarification';
import type { ToolCallRecord } from '../loopDetection';
import { normalizeToolName } from '../tools/toolNameNormalization';

export const CLARIFICATION_REVIEW_REQUIRED_CODE = 'clarification_review_required';

type ClarificationReviewReason =
  | { kind: 'catalog_alternatives'; suggestedCategories: string[] }
  | { kind: 'runtime_integration_completed' };

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

function readCatalogRecoveryCategories(entry: ToolCallRecord): string[] {
  if (
    normalizeToolName(entry.name) !== 'tool_catalog' ||
    entry.status !== 'completed' ||
    typeof entry.result !== 'string'
  ) {
    return [];
  }
  try {
    const result = JSON.parse(entry.result) as Record<string, unknown>;
    const recovery = result.recovery;
    if (
      result.mode !== 'search' ||
      result.totalMatches !== 0 ||
      !recovery ||
      typeof recovery !== 'object' ||
      Array.isArray(recovery)
    ) {
      return [];
    }
    const suggestedCategories = (recovery as Record<string, unknown>).suggestedCategories;
    if (!Array.isArray(suggestedCategories)) {
      return [];
    }
    return Array.from(
      new Set(
        suggestedCategories
          .filter((category): category is string => typeof category === 'string')
          .map((category) => category.trim())
          .filter(Boolean),
      ),
    );
  } catch {
    return [];
  }
}

function resolveClarificationReviewReason(
  toolCallHistory: ReadonlyArray<ToolCallRecord>,
): ClarificationReviewReason | undefined {
  for (let index = toolCallHistory.length - 1; index >= 0; index -= 1) {
    const entry = toolCallHistory[index]!;
    if (normalizeToolName(entry.name) === 'tool_catalog' && entry.status === 'completed') {
      const suggestedCategories = readCatalogRecoveryCategories(entry);
      if (suggestedCategories.length > 0) {
        return { kind: 'catalog_alternatives', suggestedCategories };
      }
      break;
    }
  }
  if (
    toolCallHistory.some(
      (entry) => entry.status === 'completed' && isRuntimeExternalToolName(entry.name),
    )
  ) {
    return { kind: 'runtime_integration_completed' };
  }
  return undefined;
}

/**
 * Opaque integrations are discovered and operated by the assistant, not the user.
 * When code-owned discovery reports another viable category, or an integration has
 * already worked, require one bounded second look before transferring a supposedly
 * missing integration detail back to the user.
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
  const reviewReason = resolveClarificationReviewReason(params.toolCallHistory);
  if (!reviewReason) {
    return undefined;
  }

  const catalogRecovery = reviewReason.kind === 'catalog_alternatives';

  return JSON.stringify({
    status: 'error',
    code: CLARIFICATION_REVIEW_REQUIRED_CODE,
    error: catalogRecovery
      ? 'Clarification was not registered yet because tool discovery reported viable alternative categories.'
      : 'Clarification was not registered yet because a runtime integration already completed in this run.',
    retryable: true,
    sideEffectApplied: false,
    recovery: {
      requiredAction: catalogRecovery
        ? 'Retry tool_catalog without a category or with one of suggestedCategories before requesting user input. Reissue request_clarification only if discovery still cannot expose a required tool and a specific user-owned value or choice remains unavailable.'
        : 'Re-evaluate the original request and active integration tools. Reuse a previously successful read or verification tool when it can resolve the remaining step. Reissue request_clarification only if a specific user-owned value or choice is still unavailable after the available tool paths are exhausted.',
      ...(catalogRecovery ? { suggestedCategories: reviewReason.suggestedCategories } : {}),
    },
  });
}
