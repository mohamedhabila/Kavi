// ---------------------------------------------------------------------------
// Kavi — Tool Executor
// ---------------------------------------------------------------------------
// Central dispatcher: routes tool calls to the correct executor.

import { logToolCall } from '../../services/security/audit';
import { useToolPermissionsStore } from '../../services/security/permissions';
import { needsApprovalWithContext, requestToolApproval } from '../../services/remote/approvalStore';
import {
  dispatchAuthorizedToolEffect,
  isCodeOwnedEffectFreeInvocation,
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
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';

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

export async function executeTool(
  name: string,
  argsString: string,
  conversationId: string,
  context?: ToolExecutionContext,
): Promise<ToolRuntimeOutcome> {
  const normalizedName = resolveRegisteredToolName(name);

  // Permission check
  const permissions = useToolPermissionsStore.getState();
  if (!permissions.isAllowed(normalizedName)) {
    logToolCall(normalizedName, argsString, 'denied', 0, conversationId);
    return failedToolOutcome(
      `Error: tool "${normalizedName}" is not allowed by your permission settings`,
    );
  }

  const isRuntimeExternalNamespace =
    normalizedName.startsWith('mcp__') || normalizedName.startsWith('skill__');
  if (!isRuntimeExternalNamespace && !isRegisteredToolName(normalizedName)) {
    const result = `Error: unknown tool "${normalizedName}".`;
    finalizeEffectReceiptCapture(context);
    logToolCall(normalizedName, argsString, 'error', 0, conversationId, 'unknown_tool');
    return failedToolOutcome(result);
  }

  let parsedArgs: any;
  try {
    parsedArgs = argsString ? JSON.parse(argsString) : {};
  } catch {
    parsedArgs = {};
  }

  const effectFreeInvocation = isCodeOwnedEffectFreeInvocation(normalizedName, argsString);
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
    return failedToolOutcome(result);
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
    return failedToolOutcome(result);
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
    return failedToolOutcome(result);
  }

  // Approval gate — blocks destructive/sensitive tools until human approves.
  // Durable effect preparation happens only after this decision.
  const approvalRequired = needsApprovalWithContext(normalizedName, parsedArgs);
  if (approvalRequired) {
    const truncatedArgs = argsString.length > 200 ? argsString.slice(0, 200) + '…' : argsString;
    const decision = await requestToolApproval({
      toolName: normalizedName,
      targetId: parsedArgs?.targetId,
      args: parsedArgs,
      description: `Execute ${normalizedName}(${truncatedArgs})`,
    });
    if (decision !== 'approved') {
      logToolCall(normalizedName, argsString, 'denied', 0, conversationId);
      return failedToolOutcome(`Error: tool "${normalizedName}" was ${decision} by user approval`);
    }
  }

  const startTime = Date.now();
  const executorContext = isolateExecutorContext(context);
  const runtimeExternalBinding = resolveRuntimeExternalToolBinding(
    normalizedName,
    context?.runtimeToolDeclaration,
  );
  const runtimeExternalEvidence = runtimeExternalBinding?.evidence;
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
    return failedToolOutcome(result);
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
    return failedToolOutcome(result);
  }

  if (context?.toolCallId && !effectFreeInvocation) {
    if (!isCodeOwnedExecutionRunId(executionRunId)) {
      throw new Error('execution_run_identity_invariant_violated');
    }
    const dispatched = await dispatchAuthorizedToolEffect({
      conversationId,
      toolCallId: context.toolCallId,
      toolName: normalizedName,
      argumentsText: argsString,
      context: { ...context, executionRunId },
      approvalState: approvalRequired ? 'granted' : 'not_required',
      authority: {
        approvalGranted: () => true,
        permissionGranted: () =>
          useToolPermissionsStore.getState().isAllowed(normalizedName) &&
          runtimeExternalBinding?.isCurrent() !== false,
        controlGranted: () => context.executionSignal?.aborted !== true,
      },
      runtimeExternalEvidence,
      execute: (claim) =>
        runtimeExternalBinding
          ? runtimeExternalBinding.execute(argsString, conversationId, executorContext)
          : executeToolInner(normalizedName, argsString, conversationId, executorContext, claim),
    });
    finalizeEffectReceiptCapture(context);
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
      return dispatched.requiresReconciliation || dispatched.status === 'failed'
        ? failedToolOutcome(visibleResult)
        : completedToolOutcome(visibleResult);
    } else {
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
    return failedToolOutcome(dispatched.result);
  }

  let outcome: ToolRuntimeOutcome;
  try {
    outcome = runtimeExternalBinding
      ? await runtimeExternalBinding.execute(argsString, conversationId, executorContext)
      : await executeToolInner(normalizedName, argsString, conversationId, executorContext);
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
    return failedToolOutcome(`Error: ${message}`);
  }
  if (context?.toolCallId) {
    if (!isCodeOwnedExecutionRunId(context.executionRunId)) {
      throw new Error('execution_run_identity_invariant_violated');
    }
    try {
      publishReceipt(
        await buildToolEffectReceipt({
          toolCallId: context.toolCallId,
          toolName: normalizedName,
          argumentsText: argsString,
          resultText: outcome.content,
          transportState: 'returned',
          resultIsError: outcome.status === 'failed',
          executionRunId: context.executionRunId,
          recordedAt: Date.now(),
          runtimeExternalEvidence,
        }),
      );
    } catch {
      // Effect-free tools do not need a durable claim; receipt absence stays fail-closed.
    }
    finalizeEffectReceiptCapture(context);
  }
  return outcome;
}

// ── Tool name normalization ───────────────────────────────────────────────
export { normalizeToolName };
