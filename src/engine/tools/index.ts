// ---------------------------------------------------------------------------
// Kavi — Tool Executor
// ---------------------------------------------------------------------------
// Central dispatcher: routes tool calls to the correct executor.

import { readConversationMemory } from '../../services/memory/store';
import { logToolCall } from '../../services/security/audit';
import { useToolPermissionsStore } from '../../services/security/permissions';
import { needsApprovalWithContext, requestToolApproval } from '../../services/remote/approvalStore';
import {
  dispatchAuthorizedToolEffect,
  isCodeOwnedEffectFreeInvocation,
} from '../../services/executionJournal/toolEffectDispatchLifecycle';
import { normalizeToolName, resolveRegisteredToolName } from './toolNameNormalization';
import { executeToolInner } from './toolDispatchRouter';
import type { ToolExecutionContext } from './toolExecutionContext';
import { buildToolEffectReceipt } from '../toolExecution/toolEffectReceipt';
import { isToolResultErrorLike } from '../../utils/toolResultErrors';

// ── Central dispatcher ───────────────────────────────────────────────────

function isolateExecutorContext(
  context: ToolExecutionContext | undefined,
): ToolExecutionContext | undefined {
  if (!context) return undefined;
  const isolated = { ...context };
  delete isolated.toolCallId;
  delete isolated.executionSignal;
  delete isolated.captureEffectReceipt;
  delete isolated.finalizeEffectReceiptCapture;
  return isolated;
}

export async function executeTool(
  name: string,
  argsString: string,
  conversationId: string,
  context?: ToolExecutionContext,
): Promise<string> {
  const normalizedName = resolveRegisteredToolName(name);

  // Permission check
  const permissions = useToolPermissionsStore.getState();
  if (!permissions.isAllowed(normalizedName)) {
    logToolCall(normalizedName, argsString, 'denied', 0, conversationId);
    return `Error: tool "${normalizedName}" is not allowed by your permission settings`;
  }

  let parsedArgs: any;
  try {
    parsedArgs = argsString ? JSON.parse(argsString) : {};
  } catch {
    parsedArgs = {};
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
      return `Error: tool "${normalizedName}" was ${decision} by user approval`;
    }
  }

  const startTime = Date.now();
  const executorContext = isolateExecutorContext(context);
  const captureReceipt = context?.captureEffectReceipt;
  const finalizeReceiptCapture = (): void => {
    try {
      context?.finalizeEffectReceiptCapture?.();
    } catch {
      // Receipt consumers are ancillary and cannot alter the authoritative execution outcome.
    }
  };
  const publishReceipt = (receipt: Parameters<NonNullable<typeof captureReceipt>>[0]): void => {
    try {
      captureReceipt?.(receipt);
    } catch {
      // Receipt consumers are ancillary and cannot alter the authoritative execution outcome.
    }
  };

  if (
    context?.toolCallId &&
    !isCodeOwnedEffectFreeInvocation(normalizedName, argsString)
  ) {
    const dispatched = await dispatchAuthorizedToolEffect({
      conversationId,
      toolCallId: context.toolCallId,
      toolName: normalizedName,
      argumentsText: argsString,
      context,
      approvalState: approvalRequired ? 'granted' : 'not_required',
      authority: {
        approvalGranted: () => true,
        permissionGranted: () =>
          useToolPermissionsStore.getState().isAllowed(normalizedName),
        controlGranted: () => context.executionSignal?.aborted !== true,
      },
      execute: () => executeToolInner(normalizedName, argsString, conversationId, executorContext),
    });
    finalizeReceiptCapture();
    if (dispatched.kind === 'executed') {
      publishReceipt(dispatched.receipt);
      logToolCall(
        normalizedName,
        argsString,
        dispatched.executorThrew ? 'error' : 'success',
        Date.now() - startTime,
        conversationId,
        dispatched.executorThrew ? dispatched.result : undefined,
      );
    } else {
      logToolCall(
        normalizedName,
        argsString,
        'error',
        Date.now() - startTime,
        conversationId,
        dispatched.result,
      );
    }
    return dispatched.result;
  }

  let result: string;
  try {
    result = await executeToolInner(normalizedName, argsString, conversationId, executorContext);
    logToolCall(normalizedName, argsString, 'success', Date.now() - startTime, conversationId);
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
    return `Error: ${message}`;
  }
  if (context?.toolCallId) {
    try {
      publishReceipt(
        await buildToolEffectReceipt({
          toolCallId: context.toolCallId,
          toolName: normalizedName,
          argumentsText: argsString,
          resultText: result,
          transportState: 'returned',
          resultIsError: isToolResultErrorLike(result),
          runId: context.agentRunId,
          recordedAt: Date.now(),
        }),
      );
    } catch {
      // Effect-free tools do not need a durable claim; receipt absence stays fail-closed.
    }
    finalizeReceiptCapture();
  }
  return result;
}

// ── Tool name normalization ───────────────────────────────────────────────
export { normalizeToolName };

export async function loadMemory(conversationId: string): Promise<string | null> {
  try {
    return await readConversationMemory(conversationId);
  } catch {
    return null;
  }
}
