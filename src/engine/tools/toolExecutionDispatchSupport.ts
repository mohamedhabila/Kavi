// ---------------------------------------------------------------------------
// Kavi — Tool Executor Dispatch Support
// ---------------------------------------------------------------------------
// Extracted from index.ts to keep the central dispatcher under the project's
// line-count limit. Small, stateless helpers shared by executeTool's
// pre-dispatch and effect-dispatch branches.

import { logToolCall } from '../../services/security/audit';
import {
  type ToolEffectDispatchNotClaimedReason,
  type ToolEffectDispatchObservation,
} from '../../services/executionJournal/toolEffectDispatchLifecycle';
import type { ToolExecutionContext } from './toolExecutionContext';
import type { PersistedMobileControllerHandoff } from '../../services/executionJournal/mobileControllerHandoffStore';
import { failedToolOutcome, type ToolRuntimeOutcome } from '../../types/toolRuntimeOutcome';
import {
  buildModelTurnMemoryPolicyExpiredToolResult,
  isModelTurnMemoryPolicyBindingDurablyCurrent,
} from '../authority/modelTurnMemoryPolicyBinding';

export type ToolExecutionOutcome =
  | (ToolRuntimeOutcome & Readonly<{ effectDispatchObservation: ToolEffectDispatchObservation }>)
  | Readonly<{
      status: 'deferred';
      deferredHandoff: PersistedMobileControllerHandoff;
      effectDispatchObservation: Extract<ToolEffectDispatchObservation, { kind: 'deferred' }>;
    }>;

export function isolateExecutorContext(
  context: ToolExecutionContext | undefined,
): ToolExecutionContext | undefined {
  if (!context) return undefined;
  const isolated = { ...context };
  delete isolated.toolCallId;
  delete isolated.executionRunId;
  delete isolated.runtimeToolDeclaration;
  delete isolated.captureEffectReceipt;
  delete isolated.finalizeEffectReceiptCapture;
  delete isolated.captureEffectReconciliationRequired;
  delete isolated.modelTurnMemoryPolicyBinding;
  return isolated;
}

export function buildEffectReconciliationRequiredResult(untrustedResult: string): string {
  return JSON.stringify({
    status: 'error',
    code: 'tool_effect_reconciliation_required',
    error:
      'The tool may have changed external state, but the app could not verify the outcome. Do not retry automatically.',
    retryAllowed: false,
    untrustedToolResult: untrustedResult,
  });
}

export function finalizeEffectReceiptCapture(context: ToolExecutionContext | undefined): void {
  try {
    context?.finalizeEffectReceiptCapture?.();
  } catch {
    // Receipt consumers are ancillary and cannot alter the authoritative execution outcome.
  }
}

export function markEffectReconciliationRequired(context: ToolExecutionContext | undefined): void {
  try {
    context?.captureEffectReconciliationRequired?.();
  } catch {
    // Graph notification is ancillary to the durable journal barrier.
  }
}

export function isModelTurnAuthorityCurrent(context: ToolExecutionContext | undefined): boolean {
  const binding = context?.modelTurnMemoryPolicyBinding;
  if (!binding) return context?.toolCallId === undefined;
  return isModelTurnMemoryPolicyBindingDurablyCurrent(binding);
}

export function withEffectDispatchObservation(
  outcome: ToolRuntimeOutcome,
  observation: ToolEffectDispatchObservation,
): ToolExecutionOutcome {
  return Object.freeze({
    ...outcome,
    effectDispatchObservation: Object.freeze(observation),
  });
}

export function withPreDispatchObservation(
  outcome: ToolRuntimeOutcome,
  effectFreeInvocation: boolean,
  reason: ToolEffectDispatchNotClaimedReason,
): ToolExecutionOutcome {
  return withEffectDispatchObservation(
    outcome,
    effectFreeInvocation ? { kind: 'not_applicable' } : { kind: 'not_claimed', reason },
  );
}

export function resolveMobileControllerPreDispatchReason(
  outcome: ToolRuntimeOutcome,
  hasBinding: boolean,
): ToolEffectDispatchNotClaimedReason {
  if (outcome.status === 'failed') {
    if (outcome.failureKind === 'controller_action_review_unavailable') {
      return 'controller_action_review_unavailable';
    }
    if (outcome.failureKind === 'user_takeover_required') {
      return 'user_takeover_required';
    }
  }
  return hasBinding ? 'tool_arguments_invalid' : 'runtime_binding_unavailable';
}

export function rejectExpiredModelTurnAuthority(params: {
  context: ToolExecutionContext | undefined;
  normalizedName: string;
  argsString: string;
  conversationId: string;
  effectFreeInvocation: boolean;
}): ToolExecutionOutcome {
  const result = buildModelTurnMemoryPolicyExpiredToolResult();
  finalizeEffectReceiptCapture(params.context);
  logToolCall(
    params.normalizedName,
    params.argsString,
    'denied',
    0,
    params.conversationId,
    'model_turn_memory_epoch_expired',
  );
  return withPreDispatchObservation(
    failedToolOutcome(result, 'authority_revoked'),
    params.effectFreeInvocation,
    'model_authority_changed',
  );
}
