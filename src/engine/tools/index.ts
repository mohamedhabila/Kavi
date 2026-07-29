// ---------------------------------------------------------------------------
// Kavi — Tool Executor
// ---------------------------------------------------------------------------
// Central dispatcher: routes tool calls to the correct executor.

import { logToolCall } from '../../services/security/audit';
import { useToolPermissionsStore } from '../../services/security/permissions';
import {
  needsApprovalWithContext,
  ONE_SHOT_APPROVAL_DECISION_POLICY,
  requestToolApproval,
} from '../../services/remote/approvalStore';
import {
  dispatchAuthorizedToolEffect,
  isCodeOwnedEffectFreeInvocation,
  type ToolEffectDispatchNotClaimedReason,
  type ToolEffectDispatchObservation,
} from '../../services/executionJournal/toolEffectDispatchLifecycle';
import {
  isRegisteredToolName,
  normalizeToolName,
  resolveRegisteredToolName,
} from './toolNameNormalization';
import { executeToolInner } from './toolDispatchRouter';
import type { ToolExecutionContext } from './toolExecutionContext';
import { buildToolEffectReceipt } from '../toolExecution/toolEffectReceipt';
import { resolveRuntimeExternalToolBinding } from '../toolExecution/runtimeExternalToolBinding';
import { isCodeOwnedExecutionRunId } from '../../services/executionJournal/executionRunEffectBarrier';
import type { PersistedMobileControllerHandoff } from '../../services/executionJournal/mobileControllerHandoffStore';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';
import {
  buildModelTurnMemoryPolicyExpiredToolResult,
  isModelTurnMemoryPolicyBindingDurablyCurrent,
} from '../authority/modelTurnMemoryPolicyBinding';
import { canSettleAfterModelAuthorityChange } from '../toolExecution/modelAuthorityIndependentCompletion';
import { MOBILE_UI_ACTION_TOOL_NAME } from '../mobileController/contracts';
import { executeMobileControllerTool } from '../mobileController/toolExecution';
import { isMobileControllerDeferredExecution } from '../mobileController/runtimeExecution';
import { isEffectFreeToolPolicy } from '../durability/toolEffectPolicy';

// ── Central dispatcher ───────────────────────────────────────────────────

function isolateExecutorContext(
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

function buildEffectReconciliationRequiredResult(untrustedResult: string): string {
  return JSON.stringify({
    status: 'error',
    code: 'tool_effect_reconciliation_required',
    error:
      'The tool may have changed external state, but the app could not verify the outcome. Do not retry automatically.',
    retryAllowed: false,
    untrustedToolResult: untrustedResult,
  });
}

function finalizeEffectReceiptCapture(context: ToolExecutionContext | undefined): void {
  try {
    context?.finalizeEffectReceiptCapture?.();
  } catch {
    // Receipt consumers are ancillary and cannot alter the authoritative execution outcome.
  }
}

function markEffectReconciliationRequired(context: ToolExecutionContext | undefined): void {
  try {
    context?.captureEffectReconciliationRequired?.();
  } catch {
    // Graph notification is ancillary to the durable journal barrier.
  }
}

function isModelTurnAuthorityCurrent(context: ToolExecutionContext | undefined): boolean {
  const binding = context?.modelTurnMemoryPolicyBinding;
  if (!binding) return context?.toolCallId === undefined;
  return isModelTurnMemoryPolicyBindingDurablyCurrent(binding);
}

export type ToolExecutionOutcome =
  | (ToolRuntimeOutcome & Readonly<{ effectDispatchObservation: ToolEffectDispatchObservation }>)
  | Readonly<{
      status: 'deferred';
      deferredHandoff: PersistedMobileControllerHandoff;
      effectDispatchObservation: Extract<ToolEffectDispatchObservation, { kind: 'deferred' }>;
    }>;

function withEffectDispatchObservation(
  outcome: ToolRuntimeOutcome,
  observation: ToolEffectDispatchObservation,
): ToolExecutionOutcome {
  return Object.freeze({
    ...outcome,
    effectDispatchObservation: Object.freeze(observation),
  });
}

function withPreDispatchObservation(
  outcome: ToolRuntimeOutcome,
  effectFreeInvocation: boolean,
  reason: ToolEffectDispatchNotClaimedReason,
): ToolExecutionOutcome {
  return withEffectDispatchObservation(
    outcome,
    effectFreeInvocation ? { kind: 'not_applicable' } : { kind: 'not_claimed', reason },
  );
}

function resolveMobileControllerPreDispatchReason(
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

function rejectExpiredModelTurnAuthority(params: {
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

export async function executeTool(
  name: string,
  argsString: string,
  conversationId: string,
  context?: ToolExecutionContext,
): Promise<ToolExecutionOutcome> {
  const normalizedName = resolveRegisteredToolName(name);
  const effectFreeInvocation = isCodeOwnedEffectFreeInvocation(normalizedName, argsString);

  if (!isModelTurnAuthorityCurrent(context)) {
    return rejectExpiredModelTurnAuthority({
      context,
      normalizedName,
      argsString,
      conversationId,
      effectFreeInvocation,
    });
  }

  // Permission check
  const permissions = useToolPermissionsStore.getState();
  if (!permissions.isAllowed(normalizedName)) {
    logToolCall(normalizedName, argsString, 'denied', 0, conversationId);
    return withPreDispatchObservation(
      failedToolOutcome(
        `Error: tool "${normalizedName}" is not allowed by your permission settings`,
      ),
      effectFreeInvocation,
      'tool_permission_denied',
    );
  }

  const isRuntimeExternalNamespace =
    normalizedName.startsWith('mcp__') || normalizedName.startsWith('skill__');
  if (!isRuntimeExternalNamespace && !isRegisteredToolName(normalizedName)) {
    const result = `Error: unknown tool "${normalizedName}".`;
    finalizeEffectReceiptCapture(context);
    logToolCall(normalizedName, argsString, 'error', 0, conversationId, 'unknown_tool');
    return withPreDispatchObservation(
      failedToolOutcome(result),
      effectFreeInvocation,
      'tool_unknown',
    );
  }

  let parsedArgs: any;
  try {
    parsedArgs = argsString ? JSON.parse(argsString) : {};
  } catch {
    parsedArgs = {};
  }

  const executionRunId = context?.executionRunId;
  if (!effectFreeInvocation && !isCodeOwnedExecutionRunId(executionRunId)) {
    const result =
      'Error: Tool effect was not executed because a code-owned execution-run identity is required.';
    finalizeEffectReceiptCapture(context);
    logToolCall(
      normalizedName,
      argsString,
      'error',
      0,
      conversationId,
      'execution_run_identity_required',
    );
    return withPreDispatchObservation(
      failedToolOutcome(result),
      effectFreeInvocation,
      'execution_run_identity_required',
    );
  }
  if (context?.toolCallId && !isCodeOwnedExecutionRunId(executionRunId)) {
    const result =
      'Error: Tool receipt was not created because a code-owned execution-run identity is required.';
    finalizeEffectReceiptCapture(context);
    logToolCall(
      normalizedName,
      argsString,
      'error',
      0,
      conversationId,
      'execution_run_identity_required',
    );
    return withPreDispatchObservation(
      failedToolOutcome(result),
      effectFreeInvocation,
      'execution_run_identity_required',
    );
  }
  if (!effectFreeInvocation && !context?.toolCallId) {
    const result =
      'Error: Tool effect was not executed because a code-owned tool-call identity is required.';
    finalizeEffectReceiptCapture(context);
    logToolCall(
      normalizedName,
      argsString,
      'error',
      0,
      conversationId,
      'tool_call_identity_required',
    );
    return withPreDispatchObservation(
      failedToolOutcome(result),
      effectFreeInvocation,
      'tool_call_identity_required',
    );
  }

  const preparedMobileControllerExecution =
    normalizedName === MOBILE_UI_ACTION_TOOL_NAME
      ? await executeMobileControllerTool(argsString, context?.mobileController)
      : undefined;
  if (
    preparedMobileControllerExecution &&
    !isMobileControllerDeferredExecution(preparedMobileControllerExecution)
  ) {
    const reason = resolveMobileControllerPreDispatchReason(
      preparedMobileControllerExecution,
      context?.mobileController !== undefined,
    );
    finalizeEffectReceiptCapture(context);
    logToolCall(normalizedName, argsString, 'error', 0, conversationId, reason);
    return withPreDispatchObservation(
      preparedMobileControllerExecution,
      effectFreeInvocation,
      reason,
    );
  }

  // Approval gate — blocks destructive/sensitive tools until human approves.
  // Durable effect preparation happens only after this decision.
  const mobileControllerApprovalRequest =
    preparedMobileControllerExecution &&
    isMobileControllerDeferredExecution(preparedMobileControllerExecution)
      ? preparedMobileControllerExecution.approvalRequest
      : undefined;
  const approvalRequired =
    mobileControllerApprovalRequest !== undefined ||
    needsApprovalWithContext(normalizedName, parsedArgs);
  if (approvalRequired) {
    if (!isModelTurnAuthorityCurrent(context)) {
      return rejectExpiredModelTurnAuthority({
        context,
        normalizedName,
        argsString,
        conversationId,
        effectFreeInvocation,
      });
    }
    const truncatedArgs = argsString.length > 200 ? argsString.slice(0, 200) + '…' : argsString;
    const decision = await requestToolApproval({
      toolName: normalizedName,
      targetId: parsedArgs?.targetId,
      args: parsedArgs,
      description: `Execute ${normalizedName}(${truncatedArgs})`,
      ...(mobileControllerApprovalRequest
        ? {
            reviewPresentation: mobileControllerApprovalRequest,
            decisionPolicy: ONE_SHOT_APPROVAL_DECISION_POLICY,
          }
        : {}),
    });
    if (decision !== 'approved') {
      logToolCall(normalizedName, argsString, 'denied', 0, conversationId);
      return withPreDispatchObservation(
        failedToolOutcome(`Error: tool "${normalizedName}" was ${decision} by user approval`),
        effectFreeInvocation,
        'user_approval_denied',
      );
    }
    if (!isModelTurnAuthorityCurrent(context)) {
      return rejectExpiredModelTurnAuthority({
        context,
        normalizedName,
        argsString,
        conversationId,
        effectFreeInvocation,
      });
    }
  }

  const startTime = Date.now();
  const executorContext = isolateExecutorContext(context);
  const runtimeExternalBinding = resolveRuntimeExternalToolBinding(
    normalizedName,
    context?.runtimeToolDeclaration,
  );
  const runtimeExternalEvidence = runtimeExternalBinding?.evidence;
  const runtimeExternalEffectPolicy = runtimeExternalBinding?.effectPolicy;
  const resolvedEffectFreeInvocation =
    effectFreeInvocation || isEffectFreeToolPolicy(runtimeExternalEffectPolicy);
  const captureReceipt = context?.captureEffectReceipt;
  const publishReceipt = (receipt: Parameters<NonNullable<typeof captureReceipt>>[0]): void => {
    try {
      captureReceipt?.(receipt);
    } catch {
      // Receipt consumers are ancillary and cannot alter the authoritative execution outcome.
    }
  };

  if (isRuntimeExternalNamespace && !runtimeExternalBinding) {
    const result =
      'Error: Dynamic tool was not executed because its exact runtime binding is unavailable or stale.';
    finalizeEffectReceiptCapture(context);
    logToolCall(
      normalizedName,
      argsString,
      'error',
      Date.now() - startTime,
      conversationId,
      result,
    );
    return withPreDispatchObservation(
      failedToolOutcome(result),
      resolvedEffectFreeInvocation,
      'runtime_binding_unavailable',
    );
  }

  if (runtimeExternalBinding && !context?.toolCallId) {
    const result =
      'Error: Dynamic tool was not executed because a code-owned tool-call identity is required.';
    finalizeEffectReceiptCapture(context);
    logToolCall(
      normalizedName,
      argsString,
      'error',
      Date.now() - startTime,
      conversationId,
      'runtime_external_tool_call_identity_required',
    );
    return withPreDispatchObservation(
      failedToolOutcome(result),
      resolvedEffectFreeInvocation,
      'tool_call_identity_required',
    );
  }

  if (context?.toolCallId && !resolvedEffectFreeInvocation) {
    if (!isCodeOwnedExecutionRunId(executionRunId)) {
      throw new Error('execution_run_identity_invariant_violated');
    }
    const modelTurnMemoryPolicyBinding = context.modelTurnMemoryPolicyBinding;
    if (!modelTurnMemoryPolicyBinding) {
      throw new Error('model_turn_memory_policy_binding_invariant_violated');
    }
    const dispatched = await dispatchAuthorizedToolEffect({
      conversationId,
      toolCallId: context.toolCallId,
      toolName: normalizedName,
      argumentsText: argsString,
      context: { ...context, executionRunId },
      approvalState: approvalRequired ? 'granted' : 'not_required',
      modelTurnMemoryPolicyBinding,
      authority: {
        approvalGranted: () => true,
        permissionGranted: () =>
          useToolPermissionsStore.getState().isAllowed(normalizedName) &&
          runtimeExternalBinding?.isCurrent() !== false,
        controlGranted: () => context.executionSignal?.aborted !== true,
      },
      runtimeExternalEvidence,
      runtimeExternalEffectPolicy,
      execute: async (claim) =>
        runtimeExternalBinding
          ? await runtimeExternalBinding.execute(argsString, conversationId, executorContext)
          : normalizedName === MOBILE_UI_ACTION_TOOL_NAME
            ? (preparedMobileControllerExecution ??
              (await executeMobileControllerTool(argsString, executorContext?.mobileController)))
            : await executeToolInner(
                normalizedName,
                argsString,
                conversationId,
                executorContext,
                claim,
              ),
    });
    finalizeEffectReceiptCapture(context);
    if (dispatched.kind === 'deferred') {
      logToolCall(normalizedName, argsString, 'success', Date.now() - startTime, conversationId);
      return Object.freeze({
        status: 'deferred' as const,
        deferredHandoff: dispatched.handoff,
        effectDispatchObservation: Object.freeze({
          kind: 'deferred' as const,
          handoff: dispatched.handoff.handoffRef,
        }),
      });
    }
    if (dispatched.kind === 'executed') {
      publishReceipt(dispatched.receipt);
      const visibleResult = dispatched.requiresReconciliation
        ? buildEffectReconciliationRequiredResult(dispatched.result)
        : dispatched.result;
      if (dispatched.requiresReconciliation) {
        markEffectReconciliationRequired(context);
      }
      logToolCall(
        normalizedName,
        argsString,
        dispatched.status === 'failed' || dispatched.requiresReconciliation ? 'error' : 'success',
        Date.now() - startTime,
        conversationId,
        dispatched.requiresReconciliation
          ? 'tool_effect_reconciliation_required'
          : dispatched.status === 'failed'
            ? dispatched.result
            : undefined,
      );
      return withEffectDispatchObservation(
        dispatched.requiresReconciliation || dispatched.status === 'failed'
          ? failedToolOutcome(visibleResult)
          : completedToolOutcome(visibleResult),
        {
          kind: 'settled',
          disposition: dispatched.disposition,
          receipt: dispatched.receipt,
          retryPolicy: dispatched.retryPolicy,
          requiresReconciliation: dispatched.requiresReconciliation,
        },
      );
    } else {
      if (
        dispatched.kind === 'blocked' &&
        (dispatched.reason === 'model_authority_changed' || !isModelTurnAuthorityCurrent(context))
      ) {
        return rejectExpiredModelTurnAuthority({
          context,
          normalizedName,
          argsString,
          conversationId,
          effectFreeInvocation: resolvedEffectFreeInvocation,
        });
      }
      if (dispatched.kind === 'reconciliation_required') {
        markEffectReconciliationRequired(context);
      }
      logToolCall(
        normalizedName,
        argsString,
        'error',
        Date.now() - startTime,
        conversationId,
        dispatched.result,
      );
    }
    return withEffectDispatchObservation(
      failedToolOutcome(dispatched.result),
      dispatched.kind === 'blocked'
        ? { kind: 'not_claimed', reason: dispatched.reason }
        : { kind: 'durable_outcome_unknown', reason: dispatched.reason },
    );
  }

  let outcome: ToolRuntimeOutcome;
  try {
    if (!isModelTurnAuthorityCurrent(context)) {
      return rejectExpiredModelTurnAuthority({
        context,
        normalizedName,
        argsString,
        conversationId,
        effectFreeInvocation: resolvedEffectFreeInvocation,
      });
    }
    outcome = runtimeExternalBinding
      ? await runtimeExternalBinding.execute(argsString, conversationId, executorContext)
      : await executeToolInner(normalizedName, argsString, conversationId, executorContext);
    if (
      !isModelTurnAuthorityCurrent(context) &&
      !canSettleAfterModelAuthorityChange(normalizedName, outcome)
    ) {
      return rejectExpiredModelTurnAuthority({
        context,
        normalizedName,
        argsString,
        conversationId,
        effectFreeInvocation: resolvedEffectFreeInvocation,
      });
    }
    logToolCall(
      normalizedName,
      argsString,
      outcome.status === 'completed' ? 'success' : 'error',
      Date.now() - startTime,
      conversationId,
      outcome.status === 'failed' ? outcome.content : undefined,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logToolCall(
      normalizedName,
      argsString,
      'error',
      Date.now() - startTime,
      conversationId,
      message,
    );
    return withPreDispatchObservation(
      failedToolOutcome(`Error: ${message}`),
      resolvedEffectFreeInvocation,
      'runtime_binding_unavailable',
    );
  }
  if (context?.toolCallId) {
    if (!isCodeOwnedExecutionRunId(context.executionRunId)) {
      throw new Error('execution_run_identity_invariant_violated');
    }
    try {
      const receipt = await buildToolEffectReceipt({
        toolCallId: context.toolCallId,
        toolName: normalizedName,
        argumentsText: argsString,
        resultText: outcome.content,
        transportState: 'returned',
        resultIsError: outcome.status === 'failed',
        executionRunId: context.executionRunId,
        recordedAt: Date.now(),
        runtimeExternalEvidence,
      });
      if (
        !isModelTurnAuthorityCurrent(context) &&
        !canSettleAfterModelAuthorityChange(normalizedName, outcome)
      ) {
        return rejectExpiredModelTurnAuthority({
          context,
          normalizedName,
          argsString,
          conversationId,
          effectFreeInvocation: resolvedEffectFreeInvocation,
        });
      }
      publishReceipt(receipt);
    } catch {
      // Effect-free tools do not need a durable claim; receipt absence stays fail-closed.
    }
    finalizeEffectReceiptCapture(context);
  }
  return withEffectDispatchObservation(outcome, { kind: 'not_applicable' });
}

// ── Tool name normalization ───────────────────────────────────────────────
export { normalizeToolName };
